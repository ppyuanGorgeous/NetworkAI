"use client";
/* eslint-disable @next/next/no-img-element -- User media is served directly through the local media proxy. */

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { ApiError, deletePost, mediaUrl, publishPost, searchPosts, signIn, signUp, validateMedia, type Post } from "@/lib/api";
import { currentSession, saveSession, useSession } from "@/lib/session";
import { AIWorkbench } from "@/components/ai-workbench";

function Mark() { return <span className="brand-mark" aria-hidden="true">N<span>•</span></span>; }
function Arrow() { return <span aria-hidden="true">↗</span>; }
function Dialog({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return (
    <dialog className="modal" ref={dialog} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }} aria-label={title}>
      <div className="modal-header"><h2>{title}</h2><button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="Close dialog">×</button></div>
      {children}
    </dialog>
  );
}

function AccountForm({ signup, onClose, onSwitch, onSuccess }: { signup: boolean; onClose: () => void; onSwitch: () => void; onSuccess: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const username = String(data.get("username") || "").trim();
    const password = String(data.get("password") || "");
    if (new TextEncoder().encode(password).length > 72) { setError("Use a password of 72 bytes or fewer."); return; }
    setBusy(true); setError("");
    let created = false;
    try {
      if (signup) { await signUp(username, password); created = true; }
      const token = await signIn(username, password);
      saveSession({ username, token });
      onSuccess();
    } catch (cause) {
      if (created) { onSwitch(); setError("Your account was created. Please sign in to continue."); }
      else setError(cause instanceof Error ? cause.message : "Please try again.");
    } finally { setBusy(false); }
  }
  return (
    <Dialog title={signup ? "Make room for your ideas." : "Welcome back."} onClose={onClose} busy={busy}>
      <p className="muted">{signup ? "Create your account to share, discover, and connect." : "Sign in to explore the community and your work."}</p>
      <form className="plain-form" onSubmit={submit}>
        <label>Username<input name="username" autoComplete="username" required pattern="[a-z0-9]{1,64}" maxLength={64} placeholder="yourname" disabled={busy} /></label>
        <p className="field-hint">Lowercase letters and numbers, up to 64 characters.</p>
        <label>Password<input name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} required maxLength={72} disabled={busy} /></label>
        {error && <p className="error-message" role="alert">{error}</p>}
        <button className="button full-width" disabled={busy}>{busy ? "Please wait…" : signup ? "Create account" : "Sign in"}</button>
      </form>
      <p className="account-switch">{signup ? "Already have an account?" : "New around here?"} <button className="text-button" onClick={onSwitch} disabled={busy}>{signup ? "Sign in" : "Create an account"}</button></p>
    </Dialog>
  );
}

function Composer({ token, onClose, onPublished, onExpired, initialFile }: { token: string; onClose: () => void; onPublished: () => void; onExpired: () => void; initialFile?: File | null }) {
  const [file, setFile] = useState<File | null>(initialFile ?? null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const submitting = useRef(false);
  useEffect(() => {
    if (!file) return;
    const object = URL.createObjectURL(file);
    // The preview URL is a browser resource whose lifetime follows the selected file.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreview(object);
    return () => URL.revokeObjectURL(object);
  }, [file]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !file) return;
    const invalid = validateMedia(file);
    if (invalid) { setError(invalid); return; }
    const message = String(new FormData(event.currentTarget).get("message") || "").trim();
    if (!message) { setError("Add a caption for your post."); return; }
    submitting.current = true; setBusy(true); setError("");
    try {
      await publishPost(token, message, file);
      if (currentSession()?.token === token) onPublished();
    } catch (cause) {
      if (currentSession()?.token !== token) return;
      if (cause instanceof ApiError && cause.status === 401) { onExpired(); return; }
      setError(cause instanceof Error ? cause.message : "Your post could not be published. Please try again.");
    } finally { submitting.current = false; setBusy(false); }
  }
  return (
    <Dialog title="Share something worth discovering." onClose={onClose} busy={busy}>
      <form className="plain-form" onSubmit={submit}>
        <label>Caption<textarea name="message" required maxLength={2000} rows={4} placeholder="An idea, a moment, a work in progress…" disabled={busy} /></label>
        <label className="upload-box"><span className="upload-icon" aria-hidden="true">↥</span><strong>{file ? file.name : "Choose an image or video"}</strong><span>JPEG, PNG, GIF, WebP, MP4, MOV, WebM · up to 28 MB</span><input type="file" name="media_file" accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/webm" disabled={busy} onChange={(event) => { const next = event.target.files?.[0] ?? null; setFile(next); setPreview(null); setError(next ? validateMedia(next) || "" : ""); }} /></label>
        {file && preview && (file.type.startsWith("video/") ? <video className="upload-preview" src={preview} controls /> : <img className="upload-preview" src={preview} alt="Post media preview" />)}
        {error && <p role="alert" className="error-message">{error}</p>}
        <div className="button-row"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="button" disabled={busy || !file || Boolean(file && validateMedia(file))}>{busy ? "Publishing…" : "Publish post"} <Arrow /></button></div>
      </form>
    </Dialog>
  );
}

function PostCard({ post, own, onDelete, onAuthor }: { post: Post; own: boolean; onDelete: () => void; onAuthor: () => void }) {
  const url = mediaUrl(post.url);
  return (
    <article className="post-card">
      <div className="post-media">{url ? post.type === "video" ? <video src={url} controls preload="metadata" aria-label={`Video by ${post.user}`} /> : <img src={url} alt={post.message.slice(0, 160)} loading="lazy" referrerPolicy="no-referrer" /> : <div className="missing-media">Media unavailable</div>}</div>
      <div className="post-content"><div className="post-byline"><button className="author-button" onClick={onAuthor}><span className="avatar">{post.user.slice(0, 1).toUpperCase()}</span><span>@{post.user}</span></button>{own && <button className="text-button delete-link" onClick={onDelete} aria-label={`Delete post: ${post.message.slice(0, 40)}`}>Delete</button>}</div><p className="post-caption">{post.message}</p><div className="post-footer"><span>{post.type === "video" ? "Video" : "Image"}</span><span className="post-dot" aria-hidden="true">↗</span></div></div>
    </article>
  );
}

export function Workspace() {
  const session = useSession();
  const [authMode, setAuthMode] = useState<"signin" | "signup" | null>(null);
  const [composing, setComposing] = useState(false);
  const [initialFile, setInitialFile] = useState<File | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<{ keywords?: string; user?: string }>({});
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState("");
  const [feed, setFeed] = useState<{ key: string; posts: Post[]; error: string }>({ key: "", posts: [], error: "" });
  const [deleting, setDeleting] = useState<Post | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const deleteLock = useRef(false);
  const key = JSON.stringify([session?.token, filter, refresh]);
  const loading = Boolean(session && key !== feed.key);
  const posts = session && key === feed.key ? feed.posts : [];
  const feedError = session && key === feed.key ? feed.error : "";
  const token = session?.token;
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    searchPosts(token, filter, controller.signal).then((result) => {
      if (!controller.signal.aborted && currentSession()?.token === token) setFeed({ key, posts: result, error: "" });
    }).catch((cause) => {
      if (controller.signal.aborted || currentSession()?.token !== token) return;
      if (cause instanceof ApiError && cause.status === 401) { saveSession(null); setNotice("Your session has expired. Sign in to continue."); return; }
      setFeed({ key, posts: [], error: cause instanceof Error ? cause.message : "The feed could not be loaded." });
    });
    return () => controller.abort();
  }, [token, filter, key]);

  function expired() { saveSession(null); setComposing(false); setNotice("Your session has expired. Sign in to continue."); }
  function search(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setFilter({ keywords: query.trim() }); }
  function showAll() { setFilter({}); setQuery(""); setRefresh((value) => value + 1); }
  async function confirmDelete() {
    if (!session || !deleting || deleteLock.current) return;
    const requestToken = session.token;
    deleteLock.current = true; setDeleteBusy(true); setDeleteError("");
    try {
      await deletePost(requestToken, deleting.id);
      if (currentSession()?.token !== requestToken) return;
      setDeleting(null); setRefresh((value) => value + 1); setNotice("Your post was deleted.");
    } catch (cause) {
      if (currentSession()?.token !== requestToken) return;
      if (cause instanceof ApiError && cause.status === 401) { expired(); setDeleting(null); return; }
      setDeleteError(cause instanceof Error ? cause.message : "Your post could not be deleted.");
    } finally { deleteLock.current = false; setDeleteBusy(false); }
  }

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="site-header"><div className="nav-shell"><Link href="/" className="brand"><Mark />NetworkAI</Link><nav aria-label="Main navigation"><button className="nav-link active" onClick={showAll}>Discover</button><Link href="/about" className="nav-link">About the project <Arrow /></Link></nav><div className="nav-actions">{session ? <><span className="signed-in">@{session.username}</span><button className="text-button" onClick={() => { saveSession(null); setComposing(false); setDeleting(null); setNotice("Signed out."); }}>Sign out</button><button className="button small" onClick={() => { setInitialFile(null); setComposing(true); }}>Create post <span aria-hidden="true">+</span></button></> : <><button className="text-button" onClick={() => setAuthMode("signin")}>Sign in</button><button className="button small" onClick={() => setAuthMode("signup")}>Join the community <Arrow /></button></>}</div></div></header>
      <main id="main-content" className="main-shell">
        <section className="hero"><div className="hero-copy"><p className="eyebrow"><span />A SPACE FOR CURIOUS MINDS</p><h1>Good ideas deserve<br /><em>good company.</em></h1><p className="hero-description">Share what you’re making. Discover a fresh perspective.<br className="desktop-break" /> Find inspiration in the work around you.</p></div><div className="hero-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="idea-card card-one"><span>↗</span>Make something.</div><div className="idea-card card-two"><span>✳</span>Share the spark.</div><div className="idea-card card-three"><span>◌</span>Keep exploring.</div><div className="hero-spark">✳</div></div></section>
        {notice && <div className="notice" role="status"><span>{notice}</span><button className="text-button" onClick={() => setNotice("")} aria-label="Dismiss notification">×</button></div>}
        <section className="feed-section" aria-labelledby="feed-heading"><div className="feed-heading"><div><p className="eyebrow">THE COMMUNITY FEED</p><h2 id="feed-heading">{filter.user ? `Work by @${filter.user}` : filter.keywords ? "Your discoveries" : "A little inspiration, shared."}</h2></div>{session && <div className="feed-tabs"><button className={!filter.user ? "selected" : ""} onClick={showAll}>Explore</button><button className={filter.user === session.username ? "selected" : ""} onClick={() => { setFilter({ user: session.username }); setQuery(""); }}>My posts</button></div>}</div>
          <form className="search-form" role="search" onSubmit={search}><span aria-hidden="true">⌕</span><input aria-label="Search post captions" placeholder="Find an idea, a topic, a spark…" value={query} onChange={(event) => setQuery(event.target.value)} disabled={!session} maxLength={100} /><button className="button small" disabled={!session}>Search <Arrow /></button></form>
          {(filter.user || filter.keywords) && <div className="filter-info"><span>{filter.user ? `Author: @${filter.user}` : `Keywords: ${filter.keywords}`}</span><button className="text-button" onClick={showAll}>Clear filter ×</button></div>}
          {!session ? <div className="welcome-panel"><span className="welcome-symbol" aria-hidden="true">✳</span><h3>Your next discovery starts here.</h3><p>Sign in to explore community posts, or create an account<br className="desktop-break" /> and put your own ideas out into the world.</p><button className="button" onClick={() => setAuthMode("signup")}>Create your account <Arrow /></button><button className="text-button" onClick={() => setAuthMode("signin")}>Already a member? Sign in</button></div> : loading ? <div className="post-grid" role="status" aria-label="Loading posts">{[1, 2, 3].map((id) => <div className="skeleton-card" key={id}><div /><span /><span /></div>)}</div> : feedError ? <div className="welcome-panel" role="alert"><h3>We couldn’t load the feed.</h3><p>{feedError}</p><button className="button secondary" onClick={() => setRefresh((value) => value + 1)}>Try again</button></div> : !posts.length ? <div className="welcome-panel"><span className="welcome-symbol" aria-hidden="true">↗</span><h3>{filter.keywords || filter.user ? "No posts found." : "Be the first to share a spark."}</h3><p>{filter.keywords || filter.user ? "Try a different caption search or explore the whole feed." : "A photograph, an experiment, an idea in progress. It all starts with one post."}</p><button className="button" onClick={() => { if (filter.keywords || filter.user) showAll(); else { setInitialFile(null); setComposing(true); } }}>{filter.keywords || filter.user ? "Explore all posts" : "Create your first post"} <Arrow /></button></div> : <><div className="post-grid">{posts.map((post) => <PostCard key={post.id} post={post} own={post.user === session.username} onDelete={() => { setDeleting(post); setDeleteError(""); }} onAuthor={() => { setFilter({ user: post.user }); setQuery(""); }} />)}</div><p className="feed-end">You’re all caught up with this view. Search for something new.</p></>}
        </section>
        {session && <AIWorkbench key={session.token} token={session.token} onExpired={expired} onUseImage={(file) => { setInitialFile(file); setComposing(true); }} />}
        <section className="project-note"><span aria-hidden="true">✳</span><div><h3>Built to connect ideas.</h3><p>A full-stack project exploring media publishing, search, and thoughtful AI tools.</p></div><Link href="/about" className="text-button">See how it works <Arrow /></Link></section>
      </main>
      <footer className="site-footer"><span><strong>NetworkAI</strong> · Create. Share. Discover.</span><span>A project by Peiyuan Liu</span></footer>
      {authMode && <AccountForm signup={authMode === "signup"} onClose={() => setAuthMode(null)} onSwitch={() => setAuthMode(authMode === "signup" ? "signin" : "signup")} onSuccess={() => { setAuthMode(null); showAll(); setNotice("You’re signed in. Welcome to NetworkAI."); }} />}
      {session && composing && <Composer key={session.token} token={session.token} initialFile={initialFile} onClose={() => setComposing(false)} onExpired={expired} onPublished={() => { setComposing(false); showAll(); setNotice("Your post is live. Thanks for sharing your spark."); }} />}
      {session && deleting && <Dialog title="Delete this post?" onClose={() => setDeleting(null)} busy={deleteBusy}><p className="muted">This removes your post and its media. This action cannot be undone.</p><p className="delete-caption">{deleting.message}</p>{deleteError && <p role="alert" className="error-message">{deleteError}</p>}<div className="button-row"><button className="button secondary" onClick={() => setDeleting(null)} disabled={deleteBusy}>Keep post</button><button className="button danger" onClick={() => { void confirmDelete(); }} disabled={deleteBusy}>{deleteBusy ? "Deleting…" : "Delete post"}</button></div></Dialog>}
    </>
  );
}
