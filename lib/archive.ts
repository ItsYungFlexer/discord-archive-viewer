import { unzip } from "fflate";

export type ArchiveFile = { path: string; size: number; bytes?: Uint8Array; file?: File };
export type ArchiveAttachment = { name: string; source: string; localUrl?: string; mime?: string };
export type ArchiveReaction = { emoji: string; count: number };
export type ArchiveEmbed = { title?: string; description?: string; url?: string; color?: number };
export type ArchiveMessage = {
  id: string; timestamp: string; content: string; author: string; avatar?: string;
  attachments: ArchiveAttachment[]; reactions: ArchiveReaction[]; embeds: ArchiveEmbed[];
  channelId: string; channelName: string; groupName: string;
};
export type ArchiveChannel = { id: string; name: string; avatar?: string; kind: "dm" | "server"; groupId: string; groupName: string; messages: ArchiveMessage[] };
export type ArchiveGroup = { id: string; name: string; kind: "dm" | "server"; channels: ArchiveChannel[] };
export type ParsedArchive = { name: string; owner: string; groups: ArchiveGroup[]; channels: ArchiveChannel[]; messages: ArchiveMessage[]; fileCount: number; warnings: string[]; objectUrls: string[] };

const decoder = new TextDecoder("utf-8", { fatal: false });
const textExtensions = new Set(["json", "csv", "txt"]);
const MAX_FILES = 200_000;
const MAX_ZIP_EXPANDED = 2_000_000_000;

const norm = (path: string) => path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+/g, "/");
const base = (path: string) => norm(path).split("/").pop() || path;
const dir = (path: string) => norm(path).split("/").slice(0, -1).join("/");
const lower = (value: unknown) => String(value ?? "").toLowerCase();
const stringValue = (...values: unknown[]) => {
  const value = values.find((item) => (typeof item === "string" && item.trim().length > 0) || (typeof item === "number" && Number.isFinite(item)));
  return value == null ? "" : String(value).trim();
};

export async function filesFromFolder(files: FileList): Promise<ArchiveFile[]> {
  if (files.length > MAX_FILES) throw new Error(`This folder contains more than ${MAX_FILES.toLocaleString()} files. Choose a smaller export.`);
  return Array.from(files).map((file) => ({ path: norm(file.webkitRelativePath || file.name), size: file.size, file }));
}

function inspectZip(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let files = 0, expanded = 0, compressed = 0;
  for (let i = 0; i + 46 <= data.length; i++) {
    if (view.getUint32(i, true) !== 0x02014b50) continue;
    compressed += view.getUint32(i + 20, true);
    expanded += view.getUint32(i + 24, true);
    files++;
    const nameLen = view.getUint16(i + 28, true);
    const extraLen = view.getUint16(i + 30, true);
    const commentLen = view.getUint16(i + 32, true);
    i += 45 + nameLen + extraLen + commentLen;
  }
  if (!files) throw new Error("This does not appear to be a readable ZIP archive.");
  if (files > MAX_FILES) throw new Error(`The ZIP contains more than ${MAX_FILES.toLocaleString()} files and was blocked for safety.`);
  if (expanded > MAX_ZIP_EXPANDED) throw new Error("This ZIP expands beyond the safe in-memory limit. Extract it on your computer, then use Choose export folder; extracted folders can be larger than 2 GB.");
  if (compressed > 0 && expanded / compressed > 120) throw new Error("The ZIP has an unsafe compression ratio and was blocked.");
}

export async function filesFromZip(file: File): Promise<ArchiveFile[]> {
  const data = new Uint8Array(await file.arrayBuffer());
  inspectZip(data);
  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(data, (error, result) => error ? reject(error) : resolve(result));
  });
  return Object.entries(entries).filter(([path]) => !path.endsWith("/")).map(([path, bytes]) => ({ path: norm(path), size: bytes.byteLength, bytes }));
}

async function textOf(entry?: ArchiveFile) {
  if (!entry) return "";
  if (entry.bytes) return decoder.decode(entry.bytes);
  return entry.file?.text() ?? "";
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text.replace(/^\uFEFF/, "")); } catch { return null; }
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = "";
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const headers = (rows.shift() || []).map((h) => h.replace(/^\uFEFF/, "").trim());
  return rows.map((values) => Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""])));
}

function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function asArray(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }

function attachmentValues(value: unknown): { name: string; source: string }[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(attachmentValues);
  if (typeof value === "object") {
    const item = asRecord(value); const source = stringValue(item.url, item.proxy_url, item.path, item.filename);
    return source ? [{ name: stringValue(item.filename, base(source), "Attachment"), source }] : [];
  }
  const raw = String(value).trim();
  if (!raw) return [];
  if (raw.startsWith("[") || raw.startsWith("{")) { const parsed = safeJson(raw); if (parsed) return attachmentValues(parsed); }
  return raw.split(/[\n;,](?=\s*(?:https?:\/\/|[^,;]+\.[a-z0-9]{2,5}))/i).map((source) => source.trim()).filter(Boolean).map((source) => ({ name: base(source.split("?")[0]) || "Attachment", source }));
}

function normaliseReactions(value: unknown): ArchiveReaction[] {
  return asArray(value).map((raw) => {
    const reaction = asRecord(raw); const emoji = asRecord(reaction.emoji);
    return { emoji: stringValue(emoji.name, reaction.emoji, reaction.name, "Reaction"), count: Number(reaction.count ?? 1) || 1 };
  });
}

function normaliseEmbeds(value: unknown): ArchiveEmbed[] {
  return asArray(value).map((raw) => { const embed = asRecord(raw); return { title: stringValue(embed.title) || undefined, description: stringValue(embed.description) || undefined, url: stringValue(embed.url) || undefined, color: typeof embed.color === "number" ? embed.color : undefined }; });
}

function isImage(name: string) { return /\.(avif|bmp|gif|jpe?g|png|webp)$/i.test(name); }
function mimeFor(name: string) { const ext = name.split(".").pop()?.toLowerCase(); return ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : undefined; }

export async function parseArchive(files: ArchiveFile[], archiveName: string): Promise<ParsedArchive> {
  const warnings: string[] = [], objectUrls: string[] = [];
  const byPath = new Map(files.map((file) => [lower(norm(file.path)), file]));
  const byBase = new Map<string, ArchiveFile[]>();
  for (const file of files) { const key = lower(base(file.path)); byBase.set(key, [...(byBase.get(key) || []), file]); }
  const urlCache = new Map<string, string>();
  const localUrlFor = (entry?: ArchiveFile) => {
    if (!entry || (!entry.file && !entry.bytes)) return undefined;
    const key = norm(entry.path); const cached = urlCache.get(key); if (cached) return cached;
    const blob = entry.file || new Blob([entry.bytes!], { type: mimeFor(entry.path) });
    const url = URL.createObjectURL(blob); urlCache.set(key, url); objectUrls.push(url); return url;
  };
  const jsonFiles = files.filter((file) => file.path.toLowerCase().endsWith(".json"));
  let owner = "Archived user";
  for (const file of jsonFiles.filter((f) => /\/(?:account|user)(?:\/|\.json)/i.test("/" + f.path)).slice(0, 12)) {
    const data = asRecord(safeJson(await textOf(file))); const user = asRecord(data.user);
    const found = stringValue(data.username, data.global_name, user.username, user.global_name);
    if (found) { owner = found; break; }
  }

  const channelNames = new Map<string, string>();
  const indexFile = files.find((file) => /\/messages\/index\.json$/i.test("/" + file.path));
  if (indexFile) {
    const indexData = asRecord(safeJson(await textOf(indexFile)));
    for (const [rawKey, rawValue] of Object.entries(indexData)) {
      const value = asRecord(rawValue);
      const directText = typeof rawValue === "string" && !/[\\/]/.test(rawValue) ? rawValue : "";
      const indexedName = stringValue(value.name, value.channel_name, value.channelName, directText);
      const pathId = typeof rawValue === "string" ? rawValue.match(/(?:^|\/)c?(\d+)(?:\/|$)/i)?.[1] : undefined;
      const indexedId = stringValue(value.id, value.channel_id, rawKey.replace(/^c/i, ""), pathId);
      if (indexedId && indexedName) channelNames.set(indexedId, indexedName);
    }
  }

  const channelMetadata = files.filter((file) => /\/channel\.json$/i.test("/" + file.path));
  const channels: ArchiveChannel[] = [];
  for (const metaFile of channelMetadata) {
    const folder = dir(metaFile.path); const meta = asRecord(safeJson(await textOf(metaFile)));
    const guild = asRecord(meta.guild); const rawRecipients = asArray(meta.recipients); const recipients = rawRecipients.map(asRecord);
    const type = stringValue(meta.type);
    const dm = recipients.length > 0 || /direct|private|dm/i.test(type) || !stringValue(guild.id, meta.guild_id, meta.guildId);
    const id = stringValue(meta.id, meta.channel_id, base(folder).replace(/^c/i, ""), folder);
    const recipientName = rawRecipients.map((raw, index) => typeof raw === "string" && !/^\d+$/.test(raw.trim()) ? raw : stringValue(recipients[index].global_name, recipients[index].display_name, recipients[index].username, recipients[index].name)).filter(Boolean).join(", ");
    const indexedName = channelNames.get(id) || "";
    const rawName = stringValue(meta.name, indexedName, recipientName && `DM with ${recipientName}`, `channel-${id.slice(-6)}`);
    const name = dm ? rawName.replace(/^(?:direct message|dm) with\s+/i, "") : rawName;
    const recipientAvatar = recipients.map((recipient) => stringValue(recipient.avatar_url, recipient.avatar, recipient.icon)).find(Boolean) || "";
    const recipientAvatarFile = recipientAvatar ? byBase.get(lower(base(recipientAvatar.split("?")[0])))?.[0] : undefined;
    const channelAvatar = localUrlFor(recipientAvatarFile);
    const groupName = dm ? "Direct Messages" : stringValue(guild.name, meta.guild_name, meta.guildName, "Unknown server");
    const groupId = dm ? "direct-messages" : stringValue(guild.id, meta.guild_id, meta.guildId, `server:${groupName}`);
    const candidates = ["messages.json", "message.json", "messages.csv", "message.csv"].map((name) => byPath.get(lower(`${folder}/${name}`))).filter(Boolean) as ArchiveFile[];
    if (!candidates.length) { warnings.push(`No message file found for ${name}.`); continue; }
    const rawText = await textOf(candidates[0]);
    const rawData = candidates[0].path.toLowerCase().endsWith(".csv") ? parseCsv(rawText) : (() => { const parsed = safeJson(rawText); const rec = asRecord(parsed); return Array.isArray(parsed) ? parsed : asArray(rec.messages); })();
    const messages = (rawData as unknown[]).map((item, index): ArchiveMessage => {
      const message = asRecord(item); const authorData = asRecord(message.author);
      const rawAttachments = attachmentValues(message.attachments ?? message.Attachments ?? message.attachment);
      const attachments = rawAttachments.map(({ name: itemName, source }) => {
        const decodedName = (() => { try { return decodeURIComponent(base(source.split("?")[0])); } catch { return base(source); } })();
        const exact = byPath.get(lower(norm(source))) || byPath.get(lower(`${folder}/${source}`));
        const local = exact || byBase.get(lower(decodedName))?.[0] || byBase.get(lower(itemName))?.[0];
        const localUrl = localUrlFor(local);
        return { name: itemName || decodedName || "Attachment", source, localUrl, mime: isImage(itemName || decodedName) ? "image" : undefined };
      });
      const authorName = stringValue(authorData.global_name, authorData.username, message.author_name, message.Author, owner);
      const rawAvatar = stringValue(authorData.avatar_url, authorData.avatar);
      const avatarFile = rawAvatar ? byBase.get(lower(base(rawAvatar.split("?")[0])))?.[0] : undefined;
      const ownerAvatarFile = authorName === owner ? files.find((file) => /\/(?:account|user)\/[^/]*avatar[^/]*\.(?:avif|gif|jpe?g|png|webp)$/i.test("/" + file.path)) : undefined;
      return {
        id: stringValue(message.id, message.ID, message.message_id, `${id}:${index}`),
        timestamp: stringValue(message.timestamp, message.Timestamp, message.date, message.Date),
        content: stringValue(message.content, message.Contents, message.contents, message.Content),
        author: authorName,
        avatar: localUrlFor(avatarFile || ownerAvatarFile),
        attachments, reactions: normaliseReactions(message.reactions ?? message.Reactions), embeds: normaliseEmbeds(message.embeds ?? message.Embeds),
        channelId: id, channelName: name, groupName,
      };
    }).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    channels.push({ id, name, avatar: channelAvatar, kind: dm ? "dm" : "server", groupId, groupName, messages });
  }

  if (!channels.length) {
    const loose = files.filter((file) => /messages?\.(?:csv|json)$/i.test(file.path));
    for (const [index, file] of loose.entries()) {
      if (!textExtensions.has(file.path.split(".").pop()?.toLowerCase() || "")) continue;
      const channelName = base(dir(file.path)) || `Imported channel ${index + 1}`;
      const parsed = file.path.endsWith(".csv") ? parseCsv(await textOf(file)) : safeJson(await textOf(file));
      const rows = Array.isArray(parsed) ? parsed : asArray(asRecord(parsed).messages);
      const id = `loose:${index}`;
      const messages = rows.map((raw, messageIndex) => { const message = asRecord(raw); return { id: stringValue(message.id, message.ID, `${id}:${messageIndex}`), timestamp: stringValue(message.timestamp, message.Timestamp), content: stringValue(message.content, message.Contents), author: stringValue(asRecord(message.author).username, message.Author, owner), attachments: attachmentValues(message.attachments ?? message.Attachments).map((a) => ({ ...a })), reactions: normaliseReactions(message.reactions), embeds: normaliseEmbeds(message.embeds), channelId: id, channelName, groupName: "Recovered channels" }; });
      channels.push({ id, name: channelName, kind: "server", groupId: "recovered", groupName: "Recovered channels", messages });
    }
    if (channels.length) warnings.push("Channel metadata was not found, so message files were recovered into a generic group.");
  }

  if (!channels.length) throw new Error("No Discord message history was found. Choose the export root containing the messages folder, or an unmodified Discord data ZIP.");
  const groupMap = new Map<string, ArchiveGroup>();
  for (const channel of channels) {
    const existing = groupMap.get(channel.groupId) || { id: channel.groupId, name: channel.groupName, kind: channel.kind, channels: [] };
    existing.channels.push(channel); groupMap.set(channel.groupId, existing);
  }
  const groups = [...groupMap.values()].sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dm" ? -1 : 1);
  const messages = channels.flatMap((channel) => channel.messages);
  if (!messages.length) warnings.push("Channels were found, but their exported message files were empty.");
  return { name: archiveName.replace(/\.zip$/i, ""), owner, groups, channels, messages, fileCount: files.length, warnings, objectUrls };
}

export function formatTimestamp(value: string) {
  const date = new Date(value); if (Number.isNaN(date.getTime())) return value || "Unknown time";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
