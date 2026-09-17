"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Archive, ChevronDown, FileArchive, FileText, FolderOpen, Hash, Image as ImageIcon, LockKeyhole, Menu, MessageCircle, Search, X } from "lucide-react";
import { ArchiveAttachment, ArchiveChannel, ArchiveMessage, ParsedArchive, filesFromFolder, filesFromZip, formatTimestamp, parseArchive } from "@/lib/archive";

declare global {
  interface Document { modelContext?: { registerTool(tool: Record<string, unknown>, options?: { signal?: AbortSignal }): void | Promise<void> } }
}

function initials(name: string) { return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?"; }
function avatarColor(seed: string) { const colors = ["#5865a8", "#8d5576", "#467d75", "#a06447", "#735a9e", "#49769d"]; let hash = 0; for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) | 0; return colors[Math.abs(hash) % colors.length]; }
function isImageAttachment(attachment: ArchiveAttachment) { return attachment.mime === "image" || /\.(avif|bmp|gif|jpe?g|png|webp)$/i.test(attachment.name); }

function MessageCard({ message }: { message: ArchiveMessage }) {
  return <article className="message-row" id={`message-${message.id}`}>
    <div className="avatar" style={{ background: avatarColor(message.author) }}>{message.avatar ? <img src={message.avatar} alt="" /> : initials(message.author)}</div>
    <div className="message-body">
      <div className="message-meta"><strong>{message.author}</strong><time dateTime={message.timestamp}>{formatTimestamp(message.timestamp)}</time></div>
      {message.content && <p className="message-content">{message.content}</p>}
      {message.embeds.map((embed, index) => <div className="embed-card" key={`${message.id}-embed-${index}`} style={embed.color ? { borderLeftColor: `#${embed.color.toString(16).padStart(6, "0")}` } : undefined}>
        {embed.title && <strong>{embed.title}</strong>}{embed.description && <p>{embed.description}</p>}{embed.url && <span>{embed.url}</span>}
      </div>)}
      {!!message.attachments.length && <div className="attachment-grid">{message.attachments.map((attachment, index) => attachment.localUrl && isImageAttachment(attachment)
        ? <figure className="media-card" key={`${message.id}-file-${index}`}><img src={attachment.localUrl} alt={attachment.name} loading="lazy" /><figcaption>{attachment.name}</figcaption></figure>
        : <div className="file-card" key={`${message.id}-file-${index}`}>{isImageAttachment(attachment) ? <ImageIcon size={19} /> : <FileText size={19} />}<div><strong>{attachment.name}</strong><span>{attachment.localUrl ? "Included in export" : "Reference only · not loaded from the internet"}</span></div>{attachment.localUrl && <a href={attachment.localUrl} download={attachment.name}>Save</a>}</div>)}</div>}
      {!!message.reactions.length && <div className="reactions">{message.reactions.map((reaction, index) => <span key={`${reaction.emoji}-${index}`}>{reaction.emoji} {reaction.count}</span>)}</div>}
    </div>
  </article>;
}

export default function Home() {
  const [archive, setArchive] = useState<ParsedArchive | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const folderInput = useRef<HTMLInputElement | null>(null);
  const zipInput = useRef<HTMLInputElement | null>(null);
  const previousUrls = useRef<string[]>([]);

  const selectedChannel = archive?.channels.find((channel) => channel.id === selectedChannelId) ?? null;
  const searchResults = useMemo(() => {
    const term = query.trim().toLowerCase(); if (!archive || !term) return [];
    return archive.messages.filter((message) => `${message.content} ${message.author} ${message.channelName} ${message.groupName}`.toLowerCase().includes(term)).slice(0, 500);
  }, [archive, query]);
  const visibleMessages = query.trim() ? searchResults : (selectedChannel?.messages.slice(-1000) ?? []);

  useEffect(() => () => previousUrls.current.forEach(URL.revokeObjectURL), []);
  useEffect(() => {
    const context = document.modelContext; if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: Record<string, unknown>) => { try { void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => undefined); } catch { /* unsupported preview */ } };
    register({ name: "search_archive", title: "Search archive", description: "Search the currently opened local Discord archive and show matching messages.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute(input: unknown) { const value = String((input as { query?: unknown })?.query ?? "").trim(); if (!value) throw new Error("query is required"); setQuery(value); return { query: value, matches: archive?.messages.filter((m) => `${m.content} ${m.author} ${m.channelName} ${m.groupName}`.toLowerCase().includes(value.toLowerCase())).length ?? 0 }; } });
    register({ name: "open_archive_channel", title: "Open archive channel", description: "Navigate to a channel in the currently opened archive by channel ID.", inputSchema: { type: "object", properties: { channelId: { type: "string" } }, required: ["channelId"], additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute(input: unknown) { const id = String((input as { channelId?: unknown })?.channelId ?? ""); const channel = archive?.channels.find((item) => item.id === id); if (!channel) throw new Error("Channel not found"); setQuery(""); setSelectedGroupId(channel.groupId); setSelectedChannelId(channel.id); return { channelId: id, name: channel.name, messages: channel.messages.length }; } });
    return () => lifecycle.abort();
  }, [archive]);

  async function load(kind: "folder" | "zip", files: FileList) {
    if (!files.length) return;
    setError(""); setLoading(kind === "zip" ? "Checking and opening ZIP…" : "Reading export folder…");
    try {
      const archiveFiles = kind === "zip" ? await filesFromZip(files[0]) : await filesFromFolder(files);
      setLoading(`Parsing ${archiveFiles.length.toLocaleString()} files…`);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const parsed = await parseArchive(archiveFiles, kind === "zip" ? files[0].name : (files[0].webkitRelativePath.split("/")[0] || "Discord export"));
      previousUrls.current.forEach(URL.revokeObjectURL); previousUrls.current = parsed.objectUrls;
      setArchive(parsed); const initial = parsed.channels.find((channel) => channel.messages.length) || parsed.channels[0];
      setSelectedGroupId(initial.groupId); setSelectedChannelId(initial.id); setQuery(""); setMobileNav(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The export could not be opened."); }
    finally { setLoading(""); if (folderInput.current) folderInput.current.value = ""; if (zipInput.current) zipInput.current.value = ""; }
  }
  function pickFolder(event: ChangeEvent<HTMLInputElement>) { if (event.target.files) void load("folder", event.target.files); }
  function pickZip(event: ChangeEvent<HTMLInputElement>) { if (event.target.files) void load("zip", event.target.files); }
  function openChannel(channel: ArchiveChannel) { setSelectedGroupId(channel.groupId); setSelectedChannelId(channel.id); setQuery(""); setMobileNav(false); }

  return <main className={`app-shell ${archive ? "archive-open" : ""}`}>
    <input ref={(node) => { folderInput.current = node; node?.setAttribute("webkitdirectory", ""); node?.setAttribute("directory", ""); }} className="sr-only" type="file" multiple onChange={pickFolder} />
    <input ref={zipInput} className="sr-only" type="file" accept=".zip,application/zip" onChange={pickZip} />
    <aside className="rail" aria-label="Servers and direct messages">
      <button className="brand-mark" type="button" title="Archive overview" onClick={() => archive && setSelectedGroupId(archive.groups[0]?.id || "")}><Archive size={23} /></button>
      <div className="rail-divider" />
      {archive ? archive.groups.map((group) => <button key={group.id} className={`server-badge ${selectedGroupId === group.id ? "active" : ""}`} type="button" title={group.name} onClick={() => { setSelectedGroupId(group.id); const first = group.channels[0]; if (first) openChannel(first); }}>{group.kind === "dm" ? <MessageCircle size={20} /> : initials(group.name)}</button>) : <><div className="server-badge active">DA</div><div className="server-badge muted-server">M</div><div className="server-badge muted-server">G</div></>}
    </aside>
    <aside className={`channel-pane ${mobileNav ? "mobile-open" : ""}`}>
      <header className="workspace-title"><div><span className="eyebrow">Local archive</span><strong>{archive?.name || "Discord Archive"}</strong></div><button className="icon-button mobile-close" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={18} /></button><LockKeyhole className="desktop-lock" size={16} /></header>
      <label className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search all messages" disabled={!archive} />{query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X size={14} /></button>}</label>
      <nav className="channel-list" aria-label="Archive channels">
        {!archive ? <><p className="section-label">START HERE</p><button className="channel active" type="button"><Hash size={17} /> archive-welcome</button><p className="section-label">DIRECT MESSAGES</p><div className="channel placeholder"><span className="avatar-mini">A</span> Alex</div><div className="channel placeholder"><span className="avatar-mini coral">M</span> Morgan</div><p className="section-label">SERVERS</p><div className="channel placeholder"><Hash size={17} /> general</div><div className="channel placeholder"><Hash size={17} /> photos</div></> : archive.groups.filter((group) => group.id === selectedGroupId).map((group) => <div key={group.id}><p className="section-label">{group.name}</p>{group.channels.map((channel) => <button key={channel.id} className={`channel ${channel.id === selectedChannelId && !query ? "active" : ""}`} type="button" onClick={() => openChannel(channel)}>{group.kind === "dm" ? <span className="avatar-mini" style={{ background: avatarColor(channel.name) }}>{channel.avatar ? <img src={channel.avatar} alt="" /> : initials(channel.name)}</span> : <Hash size={17} />}<span className="channel-name">{channel.name}</span><small>{channel.messages.length}</small></button>)}</div>)}
        {archive && query && <div className="search-summary"><Search size={18} /><strong>{searchResults.length}{searchResults.length === 500 ? "+" : ""} matches</strong><span>across {archive.channels.length} channels</span></div>}
      </nav>
      <div className="offline-card"><LockKeyhole size={15} /><div><strong>Offline by design</strong><span>Your files never leave this browser.</span></div></div>
    </aside>
    <section className="content-pane">
      <header className="content-header"><div><button className="icon-button menu-button" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={20} /></button><span className="hash">{selectedChannel?.kind === "dm" ? <MessageCircle size={20} /> : "#"}</span><strong>{query ? `Search: ${query}` : selectedChannel?.name || "archive-welcome"}</strong></div><span className="status-pill">{archive ? `${visibleMessages.length.toLocaleString()} shown` : "Ready to import"}</span></header>
      <div className="message-scroll">
        {!archive ? <div className="welcome-block"><div className="welcome-icon"><Archive size={34} /></div><h1>Your Discord history, kept local.</h1><p>Open a Discord data package to browse exported servers, channels, direct messages, and searchable message history.</p><div className="import-actions"><button className="primary-button" type="button" onClick={() => folderInput.current?.click()}><FolderOpen size={18} /> Choose export folder</button><button className="secondary-button" type="button" onClick={() => zipInput.current?.click()}><FileArchive size={18} /> Open ZIP file</button></div><p className="privacy-note"><LockKeyhole size={14} /> No sign-in. No Discord connection. Nothing is uploaded.</p><p className="large-archive-note">Archive larger than 2 GB? Extract the ZIP first, then choose its folder.</p>{loading && <div className="notice loading-notice"><span className="spinner" />{loading}</div>}{error && <div className="notice error-notice"><AlertTriangle size={17} />{error}</div>}</div> : <>
          <div className="channel-intro"><div className="welcome-icon compact">{query ? <Search size={24} /> : selectedChannel?.kind === "dm" ? <MessageCircle size={24} /> : <Hash size={26} />}</div><h1>{query ? `Search results for “${query}”` : selectedChannel?.name}</h1><p>{query ? `${searchResults.length}${searchResults.length === 500 ? "+" : ""} matching messages across the archive.` : `${selectedChannel?.messages.length.toLocaleString()} exported messages · ${selectedChannel?.groupName}`}</p></div>
          {!visibleMessages.length ? <div className="empty-state"><Search size={25} /><strong>{query ? "No messages match this search" : "No exported messages in this channel"}</strong><span>{query ? "Try a name, phrase, or channel." : "The export contains channel metadata, but no message rows here."}</span></div> : visibleMessages.map((message) => <MessageCard key={`${message.channelId}-${message.id}`} message={message} />)}
        </>}
      </div>
    </section>
    <aside className="details-pane">
      <span className="details-kicker">ARCHIVE STATUS</span>
      <div className="empty-ring">{archive ? <span>{initials(archive.owner)}</span> : <Archive size={25} />}</div>
      <h2>{archive ? archive.owner : "No package open"}</h2><p>{archive ? archive.name : "Choose an extracted export folder or the original ZIP file."}</p>
      <dl><div><dt>Network</dt><dd>Off</dd></div><div><dt>Mode</dt><dd>Read only</dd></div><div><dt>Messages</dt><dd>{archive?.messages.length.toLocaleString() || "—"}</dd></div><div><dt>Channels</dt><dd>{archive?.channels.length.toLocaleString() || "—"}</dd></div><div><dt>Files scanned</dt><dd>{archive?.fileCount.toLocaleString() || "—"}</dd></div></dl>
      {!!archive?.warnings.length && <div className="warning-box"><AlertTriangle size={16} /><div><strong>Import notes</strong>{archive.warnings.slice(0, 4).map((warning) => <p key={warning}>{warning}</p>)}</div></div>}
      {archive && <div className="reimport"><button type="button" onClick={() => folderInput.current?.click()}><FolderOpen size={15} /> Open another folder</button><button type="button" onClick={() => zipInput.current?.click()}><FileArchive size={15} /> Open another ZIP</button></div>}
    </aside>
    {mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
  </main>;
}
