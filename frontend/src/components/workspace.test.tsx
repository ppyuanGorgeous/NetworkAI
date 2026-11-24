import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError, deletePost, publishPost, searchPosts, signIn, signUp, type Post } from "@/lib/api";
import { currentSession, saveSession } from "@/lib/session";
import { Workspace } from "./workspace";

vi.mock("@/lib/api", async (original) => ({ ...await original<typeof import("@/lib/api")>(), searchPosts: vi.fn(), signIn: vi.fn(), signUp: vi.fn(), publishPost: vi.fn(), deletePost: vi.fn() }));
vi.mock("@/components/ai-workbench", () => ({ AIWorkbench: () => null }));
const posts: Post[] = [
  { id: "post-a", user: "alice", message: "My prototype", type: "image", url: "/api/backend/media/a.png" },
  { id: "post-b", user: "bob", message: "A fresh perspective", type: "image", url: "/api/backend/media/b.png" },
];
beforeEach(() => {
  vi.resetAllMocks();
  saveSession(null);
  vi.mocked(searchPosts).mockResolvedValue(posts);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() }));
});
afterEach(() => { cleanup(); saveSession(null); vi.unstubAllGlobals(); });
function signedIn() { saveSession({ username: "alice", token: "alice-token" }); render(<Workspace />); }
it("shows an honest signed-out state without fetching private posts", () => {
  render(<Workspace />);
  expect(screen.getByRole("heading", { name: "Your next discovery starts here." })).toBeTruthy();
  expect(searchPosts).not.toHaveBeenCalled();
});
it("registers and signs in using real API contracts", async () => {
  vi.mocked(signUp).mockResolvedValue(); vi.mocked(signIn).mockResolvedValue("new-token");
  render(<Workspace />);
  fireEvent.click(screen.getByRole("button", { name: "Join the community" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Username"), { target: { value: "alice" } });
  fireEvent.change(within(dialog).getByLabelText("Password"), { target: { value: "local-password" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Create account" }));
  await waitFor(() => expect(searchPosts).toHaveBeenCalledWith("new-token", {}, expect.any(AbortSignal)));
  expect(signUp).toHaveBeenCalledWith("alice", "local-password");
  expect(signIn).toHaveBeenCalledWith("alice", "local-password");
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("fetches server posts and supports caption searches", async () => {
  signedIn();
  await screen.findByText("My prototype");
  fireEvent.change(screen.getByRole("textbox", { name: "Search post captions" }), { target: { value: "fresh ideas" } });
  fireEvent.submit(screen.getByRole("search"));
  await waitFor(() => expect(searchPosts).toHaveBeenLastCalledWith("alice-token", { keywords: "fresh ideas" }, expect.any(AbortSignal)));
});
it("only offers deletion for the current author's post and requires confirmation", async () => {
  signedIn(); await screen.findByText("My prototype");
  expect(screen.getAllByRole("button", { name: /Delete post:/ })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Delete post: My prototype" }));
  expect(deletePost).not.toHaveBeenCalled();
  const dialog = screen.getByRole("dialog", { name: "Delete this post?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Keep post" }));
  expect(deletePost).not.toHaveBeenCalled();
});
it("keeps the delete dialog open on API failure and shows a retryable error", async () => {
  vi.mocked(deletePost).mockRejectedValue(new ApiError("Storage unavailable", 503));
  signedIn(); await screen.findByText("My prototype");
  fireEvent.click(screen.getByRole("button", { name: "Delete post: My prototype" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete post" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Storage unavailable");
  expect(screen.getByRole("dialog")).toBeTruthy();
});
it("publishes the selected media only after an explicit submit", async () => {
  vi.mocked(publishPost).mockResolvedValue(posts[0]);
  signedIn(); await screen.findByText("My prototype");
  fireEvent.click(screen.getByRole("button", { name: "Create post" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Caption"), { target: { value: "A new experiment" } });
  const file = new File(["image-content"], "experiment.png", { type: "image/png" });
  fireEvent.change(dialog.querySelector('input[type="file"]')!, { target: { files: [file] } });
  expect(publishPost).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Publish post" }));
  await waitFor(() => expect(publishPost).toHaveBeenCalledWith("alice-token", "A new experiment", file));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
it("expires an invalid session without exposing previously fetched posts", async () => {
  vi.mocked(searchPosts).mockRejectedValue(new ApiError("Your session has expired.", 401));
  signedIn();
  await screen.findByText("Your session has expired. Sign in to continue.");
  expect(screen.queryByText("My prototype")).toBeNull();
  expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
});
it("ignores a late feed response after sign-out", async () => {
  let finish!: (posts: Post[]) => void;
  vi.mocked(searchPosts).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  signedIn();
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await act(async () => finish(posts));
  expect(screen.queryByText("My prototype")).toBeNull();
});
it("does not sign out a new account when an old feed request expires before effect cleanup", async () => {
  let fail!: (error: Error) => void;
  vi.mocked(searchPosts).mockImplementation((token) => token === "alice-token"
    ? new Promise((_, reject) => { fail = reject; })
    : Promise.resolve([posts[1]]));
  const view = render(<Workspace />);
  act(() => saveSession({ username: "alice", token: "alice-token" }));
  await waitFor(() => expect(searchPosts).toHaveBeenCalledWith("alice-token", {}, expect.any(AbortSignal)));

  // Exercise the boundary after the new identity is stored, before React cleans up the old query.
  const nextAccount = { username: "bob", token: "bob-token" };
  sessionStorage.setItem("networkai.session.v1", JSON.stringify(nextAccount));
  await act(async () => fail(new ApiError("Your session has expired.", 401)));

  expect(currentSession()).toEqual(nextAccount);
  view.rerender(<Workspace />);
  expect(await screen.findByText("A fresh perspective")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  expect(screen.queryByText("Your session has expired. Sign in to continue.")).toBeNull();
});
