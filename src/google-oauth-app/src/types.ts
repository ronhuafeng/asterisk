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
  isTrashed: boolean;
  labelIds: string[];
  summary?: string;
}

// --- Interface for Email Processing Rules ---
export interface Rule {
  id: string; // Unique ID for the rule
  name: string; // User-defined name for the rule
  conditionType: 'sender' | 'bodyKeywords' | 'aiPrompt';
  conditionValue: string; // e.g., sender's email, comma-separated keywords, AI prompt text
  actionType: 'summarize' | 'archive' | 'markRead' | 'addLabel';
  actionValue?: string; // e.g., label name for 'addLabel', not needed for others like archive
  aiPromptTarget?: 'sender' | 'body' | 'subject'; // Optional: specifies what part of email AI prompt applies to
}

// --- Props for RuleManager ---
export interface RuleManagerProps {
  processedEmailsFromDashboard: ProcessedEmail[];
  currentActiveRules: Rule[]; // Rules loaded by MainDashboard
  onApplyRuleAction: (rule: Rule, email: ProcessedEmail, isManualRun: boolean) => Promise<ProcessedEmail | null>;
  checkRuleCondition: (email: ProcessedEmail, rule: Rule) => Promise<boolean>; // Now returns a Promise<boolean>
  onRulesUpdated: () => void; // Callback to MainDashboard to reload rules
}
