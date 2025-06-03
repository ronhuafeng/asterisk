// --- Interfaces for Gmail API ---

// For listing messages (users.messages.list)
export interface GmailMessage {
  id: string;
  threadId: string;
}

export interface GmailListResponse {
  messages: GmailMessage[];
  nextPageToken?: string;
  resultSizeEstimate: number;
}

// For full email details (users.messages.get with format=full)
export interface MessagePartHeader {
  name: string;
  value: string;
}

export interface MessagePartBody {
  attachmentId?: string;
  size: number;
  data?: string; // base64url encoded
}

export interface MessagePart {
  partId: string;
  mimeType: string;
  filename: string;
  headers: MessagePartHeader[];
  body: MessagePartBody;
  parts?: MessagePart[]; // For multipart messages
}

export interface FullGmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  historyId: string;
  internalDate: string; // Unix timestamp ms as string
  payload: MessagePart;
  sizeEstimate: number;
  raw?: string; // base64url encoded
}

// --- Interface for Processed Email Data (used in frontend) ---
export interface ProcessedEmail {
  id: string;
  threadId: string;
  subject: string;
  sender: string;
  date: string;
  snippet: string;
  bodyPlain: string;
  bodyHtml: string;
  isUnread: boolean;
  isArchived: boolean;
  labelIds: string[];
}
