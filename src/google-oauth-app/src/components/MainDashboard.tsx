import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import {
  GmailMessage,
  GmailListResponse,
  MessagePartHeader,
  MessagePart,
  FullGmailMessage,
  ProcessedEmail,
  Rule, // Import Rule
  OnDemandSummaryState, // Import OnDemandSummaryState
  GenkitSummarizeEmailFlow // Import GenkitSummarizeEmailFlow
} from '../types'; // Import types from types.ts
import EmailViewer from './EmailViewer';
import RuleManager from './RuleManager'; // Import RuleManager
import { toast } from 'react-toastify';
import './Dashboard.css'; // Import CSS

const MainDashboard: React.FC = () => {
  const { accessToken } = useAuth();
  const [messageIdList, setMessageIdList] = useState<GmailMessage[]>([]);
  const [processedEmails, setProcessedEmails] = useState<ProcessedEmail[]>([]); // Stores detailed and parsed emails
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined);
  const [isLoadingList, setIsLoadingList] = useState<boolean>(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [modifyingEmailId, setModifyingEmailId] = useState<string | null>(null);
  const [userLabels, setUserLabels] = useState<any[]>([]); // For storing user's Gmail labels
  const [activeRules, setActiveRules] = useState<Rule[]>([]);
  const [aiConfig, setAiConfig] = useState({ endpoint: '', key: '' });
  const [currentOnDemandSummary, setCurrentOnDemandSummary] = useState<OnDemandSummaryState | null>(null);

  // --- Helper Functions for Parsing ---
  const getHeader = (headers: MessagePartHeader[], name: string): string => {
    const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
    return header ? header.value : '';
  };

  const base64UrlDecode = (input: string): string => {
    let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
    // Pad with '=' characters if necessary
    while (base64.length % 4) {
      base64 += '=';
    }
    try {
      return atob(base64);
    } catch (e) {
      console.error("Base64 decoding failed:", e, "Input:", input.substring(0,100)); // Log part of input
      return ""; // Or throw e;
    }
  };

  const parseEmailBody = (payload: MessagePart): { plain: string; html: string } => {
    let plain = '';
    let html = '';

    const findParts = (parts: MessagePart[]) => {
      for (const part of parts) {
        if (part.mimeType === 'text/plain' && part.body?.data && !plain) { // Take first plain
          plain = base64UrlDecode(part.body.data);
        } else if (part.mimeType === 'text/html' && part.body?.data && !html) { // Take first html
          html = base64UrlDecode(part.body.data);
        } else if (part.parts && part.parts.length > 0) {
          findParts(part.parts); // Recursively search in sub-parts
        }
        // If both found, no need to continue searching this level
        if (plain && html) break;
      }
    };

    if (payload.mimeType === 'text/plain' && payload.body?.data) {
      plain = base64UrlDecode(payload.body.data);
    } else if (payload.mimeType === 'text/html' && payload.body?.data) {
      html = base64UrlDecode(payload.body.data);
    } else if (payload.parts && payload.parts.length > 0) {
      findParts(payload.parts);
    }
    return { plain, html };
  };


// Note: The 'Import EmailViewer' line was already present lower down, this diff removes the type definitions above it
// and adds the new type import from types.ts. The actual EmailViewer import might be duplicated by the tool, ensure one.

// --- Email Fetching Logic ---
  const fetchMessageIds = useCallback(async (pageToken?: string, query?: string) => {
    if (!accessToken) {
      setError("Not authenticated. Cannot fetch message IDs.");
      console.error("Not authenticated. Cannot fetch message IDs.");
      return;
    }
    setIsLoadingList(true);
    setError(null);

    let effectiveQuery = query;
    if (!pageToken && !query) { // Only apply default for the very first page/refresh without a specific query
      effectiveQuery = '-in:inbox';
    }

    let url = `https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=5`;
    if (effectiveQuery) {
      url += `&q=${encodeURIComponent(effectiveQuery)}`;
    }
    if (pageToken) {
      url += `&pageToken=${pageToken}`;
    }

    try {
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: "Unknown error" }));
        console.error("Gmail API Error (List):", errorData);
        throw new Error(`Failed to fetch message list: ${response.status} ${response.statusText}. ${errorData?.error?.message || ''}`);
      }

      const data: GmailListResponse = await response.json();
      const newMessages = data.messages || [];
      setMessageIdList(prevMessages => pageToken ? [...prevMessages, ...newMessages] : newMessages);
      setNextPageToken(data.nextPageToken);

      if (newMessages.length > 0) {
        fetchAndProcessDetails(newMessages, !pageToken); // Fetch details for new messages, clear old if it's a refresh
      }

    } catch (err: any) {
      console.error("Error in fetchMessageIds:", err);
      setError(err.message || "An unknown error occurred while fetching message IDs.");
      // Don't clear messageIdList here if it's a pagination attempt that failed
      // setProcessedEmails([]); // Similarly, don't clear processed if only list update failed
      // setNextPageToken(undefined); // This might also be problematic
    } finally {
      setIsLoadingList(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]); // fetchAndProcessDetails is not a dependency here.

  const fetchAndProcessDetails = useCallback(async (messagesToFetch: GmailMessage[], clearExistingDetails: boolean) => {
    if (!accessToken) {
      console.error("Cannot fetch details, no access token.");
      return;
    }
    setIsLoadingDetails(true);

    let emailsToProcessInitial = clearExistingDetails ? [] : [...processedEmails];

    // This array will hold newly fetched and processed emails from the current batch
    const newlyFetchedAndProcessedEmailsBatch: ProcessedEmail[] = [];

    for (const messageInfo of messagesToFetch) {
      // Skip if already processed in this session (useful for "Load More" where messagesToFetch might have overlaps if not handled by messageIdList)
      // However, for rule application, we might want to re-process if rules changed.
      // For now, simple skip if ID exists.
      if (!clearExistingDetails && emailsToProcessInitial.find(e => e.id === messageInfo.id)) {
          // console.log("Skipping already processed email during fetchAndProcessDetails:", messageInfo.id);
          // continue; // This would skip rule re-application on "Load More" for existing items.
          // Instead, let's ensure we only add new items, and rule application logic handles existing.
      }

      try {
        const res = await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${messageInfo.id}?format=full`, {
          headers: { 'Authorization': `Bearer ${accessToken}` },
        });
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({ message: "Unknown error" }));
          console.warn(`Failed to fetch details for message ${messageInfo.id}: ${res.statusText}. ${errorData?.error?.message || ''}`);
          continue; // Skip this email
        }
        const fullMessage: FullGmailMessage = await res.json();

        const headers = fullMessage.payload.headers;
        const subject = getHeader(headers, 'Subject');
        const sender = getHeader(headers, 'From');
        const date = getHeader(headers, 'Date');
        const body = parseEmailBody(fullMessage.payload);

        let currentEmail: ProcessedEmail = {
          id: fullMessage.id,
          threadId: fullMessage.threadId,
          subject,
          sender,
          date,
          snippet: fullMessage.snippet,
          bodyPlain: body.plain,
          bodyHtml: body.html,
          isUnread: fullMessage.labelIds.includes('UNREAD'),
          isArchived: !fullMessage.labelIds.includes('INBOX'),
          isTrashed: fullMessage.labelIds.includes('TRASH'),
          labelIds: fullMessage.labelIds,
        };

        // Apply rules automatically to newly fetched email
        for (const rule of activeRules) {
          if (checkRuleCondition(currentEmail, rule)) {
            // console.log(`Auto-applying rule "${rule.name}" to new email "${currentEmail.subject}"`);
            const updatedEmailAfterRule = await applyRuleAction(rule, currentEmail, false); // false for isManualRun
            if (updatedEmailAfterRule) {
              currentEmail = updatedEmailAfterRule;
            }
          }
        }
        newlyFetchedAndProcessedEmailsBatch.push(currentEmail);

      } catch (detailErr: any) {
        console.warn(`Error processing message ${messageInfo.id}:`, detailErr.message);
      }
    }

    // Update the main state once with all processed emails
    if (clearExistingDetails) {
        setProcessedEmails(newlyFetchedAndProcessedEmailsBatch);
    } else {
        // Add new emails, or update existing ones if they were re-fetched and processed by rules
        setProcessedEmails(prevEmails => {
            const emailIdsInNewBatch = new Set(newlyFetchedAndProcessedEmailsBatch.map(e => e.id));
            const oldEmailsNotUpdated = prevEmails.filter(e => !emailIdsInNewBatch.has(e.id));
            return [...oldEmailsNotUpdated, ...newlyFetchedAndProcessedEmailsBatch];
        });
    }
    setIsLoadingDetails(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, activeRules, aiConfig]); // Updated dependencies for fetchAndProcessDetails

  // --- Placeholder for Genkit Flow Access ---
  // TODO: Implement this function to return the actual Genkit summarizeEmail flow
  // This might involve importing it from a specific file if it's part of the frontend bundle,
  // or accessing a globally available function if Genkit is loaded differently.
  const getSummarizeEmailFlow = (): GenkitSummarizeEmailFlow => {
    // Placeholder implementation - THIS NEEDS TO BE REPLACED
    console.warn("Placeholder: getSummarizeEmailFlow() is not implemented. Using mock summarizer.");
    return async (emailContent: string): Promise<{ summary: string }> => {
      return new Promise(resolve => {
        setTimeout(() => {
          resolve({ summary: `Mock summary for content starting with: ${emailContent.substring(0, 50)}...` });
        }, 1500); // Simulate network delay
      });
    };
  };

  // --- On-Demand Summarization Handler ---
  const handleOnDemandSummarize = useCallback(async (email: ProcessedEmail) => {
    setCurrentOnDemandSummary({
      emailId: email.id,
      summaryText: null,
      isLoading: true,
      error: null,
    });
    toast.info(`Summarizing email: "${email.subject || 'No Subject'}"...`);

    try {
      const emailContentToSummarize = email.bodyPlain || email.snippet;
      if (!emailContentToSummarize) {
        throw new Error("No content available to summarize.");
      }

      // Option 1: Use Genkit Flow (if available and configured)
      // const summarizeEmailFlow = getSummarizeEmailFlow();
      // const result = await summarizeEmailFlow(emailContentToSummarize);
      // const summary = result.summary;

      // Option 2: Use existing summarizeEmailText (direct OpenAI-compatible API call)
      // This requires aiConfig to be set via RuleManager UI
      if (!aiConfig.endpoint || !aiConfig.key) {
        throw new Error("AI API endpoint or key not configured for on-demand summarization.");
      }
      const summary = await summarizeEmailText(emailContentToSummarize, aiConfig.endpoint, aiConfig.key);


      setCurrentOnDemandSummary({
        emailId: email.id,
        summaryText: summary,
        isLoading: false,
        error: null,
      });
      // Also update the main processedEmails state so the summary persists if the user navigates or rule applies it later
      setProcessedEmails(prev => prev.map(e => e.id === email.id ? { ...e, summary: summary } : e));
      toast.success(`Summary ready for: "${email.subject || 'No Subject'}"`);

    } catch (err: any) {
      console.error("On-demand summarization error:", err);
      const errorMessage = err.message || "Failed to summarize email.";
      setCurrentOnDemandSummary({
        emailId: email.id,
        summaryText: null,
        isLoading: false,
        error: errorMessage,
      });
      toast.error(`Error summarizing: ${errorMessage}`);
    }
  }, [aiConfig.endpoint, aiConfig.key]); // Dependency on aiConfig parts used

  // --- AI Condition Evaluation ---
  const evaluateAICondition = async (textToEvaluate: string, userPrompt: string, endpoint: string, apiKey: string): Promise<boolean> => {
    if (!endpoint || !apiKey) {
      toast.warn("AI condition: API endpoint or key is not configured.");
      return false;
    }
    if (!textToEvaluate.trim()) {
        // console.log("AI condition: Text to evaluate is empty, returning false.");
        return false; // No text to evaluate
    }
     // Simple truncation if text is too long
    const MAX_AI_TEXT_LENGTH = 4000; // Shorter than summarization, as prompts can be long
    let processedText = textToEvaluate;
    if (processedText.length > MAX_AI_TEXT_LENGTH) {
        console.warn(`Text for AI condition length (${processedText.length}) exceeds ${MAX_AI_TEXT_LENGTH} chars, truncating.`);
        processedText = processedText.substring(0, MAX_AI_TEXT_LENGTH) + "... (truncated)";
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo",
          messages: [
            { role: "system", content: "You are an AI assistant that evaluates a condition based on provided text and a prompt. Respond with only 'yes' or 'no'." },
            { role: "user", content: `Based on the following text, does it satisfy this condition: "${userPrompt}"? Text: "${processedText}" Respond with only 'yes' or 'no'.` }
          ],
          max_tokens: 5
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: "Unknown API error during AI condition evaluation" }));
        console.error("AI Condition API Error:", errorData);
        toast.error(`AI Condition API error: ${errorData?.error?.message || response.statusText}`);
        return false;
      }

      const data = await response.json();
      const decision = data.choices?.[0]?.message?.content?.trim().toLowerCase();
      return decision === "yes";

    } catch (err: any) {
      console.error("evaluateAICondition error:", err);
      toast.error(`AI Condition evaluation failed: ${err.message}`);
      return false;
    }
  };

  // --- Rule Engine Core ---
  const checkRuleCondition = async (email: ProcessedEmail, rule: Rule): Promise<boolean> => {
    switch (rule.conditionType) {
      case 'sender':
        return email.sender.toLowerCase().includes(rule.conditionValue.toLowerCase());
      case 'bodyKeywords':
        const keywords = rule.conditionValue.split(',').map(kw => kw.trim().toLowerCase()).filter(kw => kw !== '');
        if (keywords.length === 0) return false;
        const emailContentForKeywords = (email.bodyPlain || email.snippet).toLowerCase();
        return keywords.every(kw => emailContentForKeywords.includes(kw));
      case 'aiPrompt':
        if (!aiConfig.endpoint || !aiConfig.key) {
          toast.warn(`AI Prompt rule "${rule.name}" skipped: AI not configured.`);
          return false;
        }
        let textToEvaluate = '';
        const target = rule.aiPromptTarget || 'body'; // Default to body if not specified
        if (target === 'body') {
          textToEvaluate = email.bodyPlain || email.snippet;
        } else if (target === 'sender') {
          textToEvaluate = email.sender;
        } else if (target === 'subject') {
          textToEvaluate = email.subject;
        }
        return await evaluateAICondition(textToEvaluate, rule.conditionValue, aiConfig.endpoint, aiConfig.key);
      default:
        return false;
    }
  };
  // --- Email Action API Calls ---
  const modifyEmail = async (messageId: string, addLabelIds: string[], removeLabelIds: string[]) => {
    if (!accessToken) {
      throw new Error("Authentication token not available.");
    }
    setModifyingEmailId(messageId);
    try {
      const response = await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ addLabelIds, removeLabelIds }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: "Unknown API error during modify" }));
        console.error(`API Error modifying email ${messageId}:`, errorData);
        throw new Error(`Failed to modify email: ${errorData?.error?.message || response.statusText}`);
      }
      const updatedMessage: FullGmailMessage = await response.json();
       setError(null); // Clear any previous general error on successful modify
      return updatedMessage;
    } catch (err: any) {
       // setError(`Failed to modify email ${messageId}. ${err.message}`); // This will be handled by toast in handlers
      throw err; // Re-throw for the handler to catch
    } finally {
      // setModifyingEmailId(null); // Handler should do this after updating state
    }
  };

  const handleMarkAsReadUnread = async (messageId: string, currentlyUnread: boolean) => {
    const originalEmails = processedEmails;
    setModifyingEmailId(messageId); // Set modifyingId early for UI feedback

    // Optimistic update
    setProcessedEmails(prevEmails =>
      prevEmails.map(email =>
        email.id === messageId ? { ...email, isUnread: !currentlyUnread } : email
      )
    );

    try {
      const addLabelIds = currentlyUnread ? [] : ['UNREAD'];
      const removeLabelIds = currentlyUnread ? ['UNREAD'] : [];
      const updatedMessage = await modifyEmail(messageId, addLabelIds, removeLabelIds);
      // Update with server confirmed state (especially labelIds)
      setProcessedEmails(prevEmails =>
        prevEmails.map(email =>
          email.id === messageId
            ? { ...email, isUnread: !currentlyUnread, labelIds: updatedMessage.labelIds }
            : email
        )
      );
      toast.success(currentlyUnread ? "Email marked as unread." : "Email marked as read.");
      setError(null); // Clear general error on success
    } catch (err: any) {
      console.error(`Error in handleMarkAsReadUnread for ${messageId}:`, err);
      toast.error(`Failed to mark as read/unread: ${err.message || 'Unknown error'}`);
      setProcessedEmails(originalEmails); // Revert on error
      setError(`Failed to mark as read/unread: ${messageId}. Reverted.`); // Keep general error for reverted optimistic
    } finally {
      setModifyingEmailId(null);
    }
  };

  const handleArchiveUnarchive = async (messageId: string, currentlyArchived: boolean) => {
    const originalEmails = processedEmails;
    setModifyingEmailId(messageId); // Set modifyingId early

    // Optimistic update
    setProcessedEmails(prevEmails =>
      prevEmails.map(email =>
        email.id === messageId ? { ...email, isArchived: !currentlyArchived } : email
      )
    );

    try {
      const addLabelIds = currentlyArchived ? ['INBOX'] : [];
      const removeLabelIds = currentlyArchived ? [] : ['INBOX'];
      const updatedMessage = await modifyEmail(messageId, addLabelIds, removeLabelIds);
      // Update with server confirmed state
      setProcessedEmails(prevEmails =>
        prevEmails.map(email =>
          email.id === messageId
            ? { ...email, isArchived: !currentlyArchived, labelIds: updatedMessage.labelIds }
            : email
        )
      );
      toast.success(currentlyArchived ? "Email moved to Inbox." : "Email archived.");
      setError(null);
    } catch (err: any) {
      console.error(`Error in handleArchiveUnarchive for ${messageId}:`, err);
      toast.error(`Failed to archive/unarchive: ${err.message || 'Unknown error'}`);
      setProcessedEmails(originalEmails); // Revert on error
      setError(`Failed to archive/unarchive: ${messageId}. Reverted.`);
    } finally {
      setModifyingEmailId(null);
    }
  };

  const handleTrashUntrash = async (messageId: string, currentlyTrashed: boolean) => {
    // No optimistic update for trash for now due to filtering complexity on immediate UI change.
    // State will update after successful API call.
    setModifyingEmailId(messageId);
    try {
      let addLabelIds: string[];
      let removeLabelIds: string[];

      if (currentlyTrashed) { // Action: Untrash
        addLabelIds = ['INBOX'];
        removeLabelIds = ['TRASH'];
      } else { // Action: Trash
        addLabelIds = ['TRASH'];
        // Find the email to check its current labels, to decide if INBOX needs to be removed
        const emailToTrash = processedEmails.find(e => e.id === messageId);
        if (emailToTrash && emailToTrash.labelIds.includes('INBOX')) {
          removeLabelIds = ['INBOX']; // Remove from Inbox when trashing
        } else {
          removeLabelIds = []; // No need to remove INBOX if it's not there (e.g. already archived)
        }
      }
      const updatedMessage = await modifyEmail(messageId, addLabelIds, removeLabelIds);

      // Update state after successful API call
      setProcessedEmails(prevEmails =>
        prevEmails.map(email =>
          email.id === messageId
            ? {
                ...email,
                isTrashed: !currentlyTrashed,
                // If untrashing, it's moved to inbox, so not archived.
                // If trashing, retain previous archived status logic (it might be archived and then trashed).
                isArchived: !currentlyTrashed ? false : email.isArchived,
                labelIds: updatedMessage.labelIds,
              }
            : email
        )
      );
      toast.success(currentlyTrashed ? "Email moved to Inbox from Trash." : "Email moved to Trash.");
      setError(null);
    } catch (err: any) {
      console.error(`Error in handleTrashUntrash for ${messageId}:`, err);
      toast.error(`Failed to move email regarding Trash: ${err.message || 'Unknown error'}`);
      // setError is already called by modifyEmail if the API call itself failed.
      // If modifyEmail didn't throw but some other logic here did, we might need an explicit setError.
      // For now, assuming modifyEmail's throw is the primary error source.
    } finally {
      setModifyingEmailId(null);
    }
  };

  useEffect(() => {
    if (accessToken) {
      // Initial fetch of message IDs, labels, and rules
      setMessageIdList([]);
      setProcessedEmails([]);
      setNextPageToken(undefined);
      setError(null);
      fetchMessageIds();
      fetchUserLabels();
      loadRulesFromStorage();
    } else {
      // Clear all data if accessToken is lost (logout)
      setMessageIdList([]);
      setProcessedEmails([]);
      setNextPageToken(undefined);
      setError(null);
      setIsLoadingList(false);
      setIsLoadingDetails(false);
      setUserLabels([]);
      setActiveRules([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, fetchMessageIds, fetchUserLabels]); // loadRulesFromStorage is stable

  // Load AI Config from localStorage on mount
  useEffect(() => {
    const storedEndpoint = localStorage.getItem('aiApiEndpoint') || '';
    const storedKey = localStorage.getItem('aiApiKey') || '';
    setAiConfig({ endpoint: storedEndpoint, key: storedKey });
    // Listen for storage changes from other tabs/windows (optional)
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === 'aiApiEndpoint') {
        setAiConfig(prev => ({ ...prev, endpoint: event.newValue || '' }));
      }
      if (event.key === 'aiApiKey') {
        setAiConfig(prev => ({ ...prev, key: event.newValue || '' }));
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // --- AI Summarization Service ---
  const summarizeEmailText = async (emailBody: string, endpoint: string, apiKey: string): Promise<string> => {
    if (!endpoint || !apiKey) {
      throw new Error("AI API endpoint or key is not configured.");
    }
    // Basic check for very short content
    if (!emailBody.trim() || emailBody.trim().length < 50) { // Arbitrary minimum length
        return "Content too short to summarize meaningfully.";
    }

    // Simple truncation if body is too long (very basic, API might have its own limits)
    const MAX_BODY_LENGTH = 15000; // Adjust based on typical API limits (e.g. 4k-16k tokens for context window)
    let processedBody = emailBody;
    if (processedBody.length > MAX_BODY_LENGTH) {
        console.warn(`Email body length (${processedBody.length}) exceeds ${MAX_BODY_LENGTH} chars, truncating for summarization.`);
        processedBody = processedBody.substring(0, MAX_BODY_LENGTH) + "... (truncated)";
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo", // This might need to be configurable or a default
          messages: [
            { role: "system", content: "You are a helpful assistant that summarizes emails concisely in one or two sentences." },
            { role: "user", content: `Summarize the following email content:

${processedBody}` }
          ],
          max_tokens: 100, // Keep summaries brief
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: "Unknown API error during summarization" }));
        console.error("AI Summarization API Error:", errorData);
        throw new Error(`API error: ${errorData?.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const summary = data.choices?.[0]?.message?.content?.trim();

      if (!summary) {
        console.error("AI Summarization: No summary content in response", data);
        throw new Error("No summary content received from API.");
      }
      return summary;

    } catch (err: any) {
      console.error("summarizeEmailText error:", err);
      // Rethrow with a more user-friendly message if possible, or let caller handle generic toast
      throw new Error(`Summarization failed: ${err.message}`);
    }
  };


  // --- Rule Engine Core ---
  const checkRuleCondition = (email: ProcessedEmail, rule: Rule): boolean => {
    switch (rule.conditionType) {
      case 'sender':
        return email.sender.toLowerCase().includes(rule.conditionValue.toLowerCase());
      case 'bodyKeywords':
        const keywords = rule.conditionValue.split(',').map(kw => kw.trim().toLowerCase()).filter(kw => kw !== '');
        if (keywords.length === 0) return false;
        const emailContent = (email.bodyPlain || email.snippet).toLowerCase();
        return keywords.every(kw => emailContent.includes(kw));
      case 'aiPrompt':
        return false; // AI rules not implemented yet
      default:
        return false;
    }
  };

  // isManualRun parameter to control toast messages for background vs manual application
  const applyRuleAction = async (rule: Rule, email: ProcessedEmail, isManualRun: boolean = false): Promise<ProcessedEmail | null> => {
    const originalModifyingEmailId = modifyingEmailId;
    // For rule actions, we generally don't want to set modifyingEmailId as it's not a direct UI interaction on one item
    // unless it's a manual run from RuleManager for a specific email (not implemented yet)
    // For automatic application, it should remain null or be restored.
    if (!isManualRun) {
      // When rules are applied automatically (e.g., on email fetch),
      // we don't want individual email items to show "Processing..." via modifyingEmailId.
      // So, if modifyingEmailId is currently set (e.g., by a user clicking a button),
      // we leave it, otherwise ensure it's null for background processing.
      // This needs careful thought: if a user clicks "mark read" (sets modifyingEmailId) and a rule also
      // wants to mark read, we don't want the rule's background processing to clear the user-facing modifyingEmailId.
      // The individual action functions (applyMarkReadAction etc.) call modifyEmail, which *does* set modifyingEmailId.
      // This is a tricky interaction.
      // For now, let's assume rule actions are "background" and should not interfere with modifyingEmailId
      // that might be set by a direct user interaction happening concurrently.
      // The individual action functions will still flash it, which is acceptable for now.
    }

    let result: ProcessedEmail | null = null;
    const toastPrefix = isManualRun ? "Manual Apply:" : "Rule:";

    try {
      switch (rule.actionType) {
        case 'markRead':
          result = await applyMarkReadAction(email, toastPrefix);
          break;
        case 'archive':
          result = await applyArchiveAction(email, toastPrefix);
          break;
        case 'addLabel':
          if (rule.actionValue) {
            result = await applyAddLabelAction(email, rule.actionValue, toastPrefix);
          } else {
            toast.error(`${toastPrefix} No label value provided for 'addLabel' action on rule "${rule.name}".`);
            result = email;
          }
          break;
        case 'summarize':
          if (!aiConfig.endpoint || !aiConfig.key) {
            toast.warn(`${toastPrefix} AI Summarization is not configured for rule "${rule.name}". Please set API details.`);
            result = email;
          } else {
            try {
              const summaryText = await summarizeEmailText(email.bodyPlain || email.snippet, aiConfig.endpoint, aiConfig.key);
              result = { ...email, summary: summaryText };
              // Update processedEmails state with the new summary
              setProcessedEmails(prev => prev.map(e => e.id === email.id ? { ...e, summary: summaryText } : e));
              toast.success(`${toastPrefix} Email "${email.subject}" summarized.`);
            } catch (summarizeErr: any) {
              toast.error(`${toastPrefix} Failed to summarize email "${email.subject}": ${summarizeErr.message}`);
              result = email; // Return original email on summarization error
            }
          }
          break;
        default:
          result = email;
      }
    } catch(error) {
        // Individual actions handle their own specific error toasts.
        // This catch is a fallback.
        toast.error(`${toastPrefix} Error applying rule "${rule.name}" to "${email.subject}".`);
        result = null; // Ensure result is null on error
    }
    // No change to modifyingEmailId here, let individual handlers like handleMarkAsReadUnread clear it.
    // Rule-based actions like applyMarkReadAction will also call modifyEmail which sets/clears it.
    // This is acceptable for now.
    return result;
  };

  // --- Label Management & Rule Loading ---
  const loadRulesFromStorage = useCallback(() => {
    const storedRules = localStorage.getItem('emailRules');
    if (storedRules) {
      try {
        const parsedRules: Rule[] = JSON.parse(storedRules);
        setActiveRules(parsedRules);
        // console.log("Rules loaded from storage:", parsedRules);
      } catch (e) {
        console.error("Failed to parse rules from localStorage", e);
        toast.error("Failed to load rules from storage. Rules may be corrupted.");
        setActiveRules([]);
      }
    } else {
      // console.log("No rules found in storage.");
      setActiveRules([]); // No rules stored
    }
  }, []); // Stable function, no dependencies needed

  // --- Label Management Functions ---
  const fetchUserLabels = useCallback(async () => {
    if (!accessToken) return;
    try {
      const response = await fetch(`https://www.googleapis.com/gmail/v1/users/me/labels`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: "Unknown error fetching labels" }));
        throw new Error(`Failed to fetch labels: ${errorData?.error?.message || response.statusText}`);
      }
      const data = await response.json();
      setUserLabels(data.labels || []);
      return data.labels || [];
    } catch (err: any) {
      console.error("Error fetching user labels:", err);
      toast.error(`Failed to fetch Gmail labels: ${err.message}`);
      return [];
    }
  }, [accessToken]);

  const createGmailLabel = async (labelName: string) => {
    if (!accessToken) throw new Error("Not authenticated");
    try {
      const response = await fetch(`https://www.googleapis.com/gmail/v1/users/me/labels`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: labelName,
          labelListVisibility: 'labelShow',
          messageListVisibility: 'messageShow',
        }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: "Unknown error creating label" }));
        throw new Error(`Failed to create label: ${errorData?.error?.message || response.statusText}`);
      }
      const newLabel = await response.json();
      toast.success(`Label "${labelName}" created successfully.`);
      // Update userLabels state
      setUserLabels(prevLabels => [...prevLabels, newLabel]);
      return newLabel;
    } catch (err: any) {
      console.error(`Error creating label "${labelName}":`, err);
      toast.error(`Failed to create label "${labelName}": ${err.message}`);
      throw err;
    }
  };

  // Fetch labels when accessToken is available
  useEffect(() => {
    if (accessToken) {
      fetchUserLabels();
    }
  }, [accessToken, fetchUserLabels]);

  // --- Rule Action Implementations ---
  // Note: `modifyingEmailId` is handled by direct user actions like `handleMarkAsReadUnread`.
  // Rule actions use `applyRuleAction` which manages `modifyingEmailId` differently.
  // Adding toastPrefix to allow differentiation in toasts if needed by caller.
  const applyMarkReadAction = async (email: ProcessedEmail, toastPrefix: string = "Rule:"): Promise<ProcessedEmail | null> => {
    if (!email.isUnread) return email;
    try {
      // modifyEmail will set modifyingEmailId, which might be an undesired side-effect for purely background rule processing.
      // This is managed by applyRuleAction wrapper for now.
      const updatedGmailMessage = await modifyEmail(email.id, [], ['UNREAD']);
      const updatedEmail = {
        ...email,
        isUnread: false,
        labelIds: updatedGmailMessage.labelIds,
      };
      setProcessedEmails(prev => prev.map(e => e.id === email.id ? updatedEmail : e));
      toast.success(`${toastPrefix} Email "${email.subject}" marked as read.`);
      return updatedEmail;
    } catch (err: any) {
      toast.error(`${toastPrefix} Error marking "${email.subject}" as read: ${err.message}`);
      return null;
    }
  };

  const applyArchiveAction = async (email: ProcessedEmail, toastPrefix: string = "Rule:"): Promise<ProcessedEmail | null> => {
    if (email.isArchived) return email;
    try {
      const updatedGmailMessage = await modifyEmail(email.id, [], ['INBOX']);
      const updatedEmail = {
        ...email,
        isArchived: true,
        labelIds: updatedGmailMessage.labelIds,
      };
      setProcessedEmails(prev => prev.map(e => e.id === email.id ? updatedEmail : e));
      toast.success(`${toastPrefix} Email "${email.subject}" archived.`);
      return updatedEmail;
    } catch (err: any) {
      toast.error(`${toastPrefix} Error archiving "${email.subject}": ${err.message}`);
      return null;
    }
  };

  const applyAddLabelAction = async (email: ProcessedEmail, labelName: string, toastPrefix: string = "Rule:"): Promise<ProcessedEmail | null> => {
    if (!labelName || !labelName.trim()) {
      toast.error(`${toastPrefix} Label name is empty for addLabel action on "${email.subject}".`);
      return null;
    }

    let targetLabel = userLabels.find(l => l.name.toLowerCase() === labelName.toLowerCase());

    try {
      if (!targetLabel) {
        // Attempt to refetch labels just in case it was created in another session/tab and userLabels state isn't updated yet.
        // This is a common scenario if RuleManager creates a label and immediately a rule uses it.
        const currentGmailLabels = await fetchUserLabels(); // Ensure userLabels is fresh
        targetLabel = currentGmailLabels.find((l: any) => l.name.toLowerCase() === labelName.toLowerCase());
        if (!targetLabel) {
          targetLabel = await createGmailLabel(labelName); // This will toast success/error for creation
          if (!targetLabel) return null;
        }
      }

      if (email.labelIds.includes(targetLabel.id)) return email;

      const updatedGmailMessage = await modifyEmail(email.id, [targetLabel.id], []);
      const updatedEmail = {
        ...email,
        labelIds: updatedGmailMessage.labelIds,
      };
      setProcessedEmails(prev => prev.map(e => e.id === email.id ? updatedEmail : e));
      toast.success(`${toastPrefix} Label "${labelName}" added to email "${email.subject}".`);
      return updatedEmail;
    } catch (err: any) {
      // createGmailLabel and modifyEmail handle their own toasts for API errors.
      // This catch is for other unexpected errors during the process.
      toast.error(`${toastPrefix} Failed to add label "${labelName}" to email "${email.subject}": ${err.message}`);
      return null;
    }
  };

  const handleRefreshRulesAndEmails = () => {
    loadRulesFromStorage(); // Reload rules from storage
    toast.info("Rules reloaded from local storage.");
    // Optionally, re-fetch emails to apply new/updated rules immediately
    // For now, rules apply to newly fetched emails or via "Apply All Rules" button.
    // To re-apply to existing loaded emails, user can click "Apply All Rules" in RuleManager
    // or we could trigger a re-process here.
    // Let's just refresh the list for now, which will re-apply to fetched emails.
    handleRefreshEmails();
  }

  const handleRefreshEmails = () => {
    // Clear all states and fetch first page of IDs, which then fetches their details
    setMessageIdList([]);
    setProcessedEmails([]); // Also clear processed emails before fetching new ones
    setNextPageToken(undefined);
    setError(null);
    if (accessToken) {
        fetchMessageIds(); // This will trigger fetchAndProcessDetails which applies rules
    }
  };

  const handleLoadMoreEmails = () => {
    if (nextPageToken && !isLoadingList && !isLoadingDetails) {
      fetchMessageIds(nextPageToken);
    } else if (isLoadingList || isLoadingDetails) {
      console.log("Already loading data...");
    } else {
      console.log("No more message IDs to load or not in a state to load more.");
    }
  };

  const isLoading = isLoadingList || isLoadingDetails; // Combined loading state

  return (
    <div className="dashboard-container">
      <h2>Email Dashboard (Default: Archived)</h2>
      <div className="dashboard-controls">
        <button onClick={handleRefreshEmails} disabled={isLoading || !accessToken}>
          {isLoadingList && !processedEmails.length ? 'Loading List...' : (isLoadingDetails && !processedEmails.length ? 'Loading Details...' : 'Refresh Emails')}
        </button>
        {nextPageToken && (
          <button onClick={handleLoadMoreEmails} disabled={isLoading}>
            {isLoadingDetails ? 'Processing Details...' : (isLoadingList ? 'Fetching More IDs...' : 'Load More Emails')}
          </button>
        )}
      </div>

      {error && <p className="error-message">Error: {error}</p>}

      <p className="status-message">Displaying: {processedEmails.length} fully processed emails (out of {messageIdList.length} fetched IDs)</p>

      {(isLoadingList && !processedEmails.length) && <p className="loading-message"><em>Loading message list... (Phase 1)</em></p>}
      {(isLoadingDetails && !processedEmails.length) && <p className="loading-message"><em>Loading full email details... (Phase 2)</em></p>}
      {(isLoadingDetails && processedEmails.length > 0) && <p className="loading-message"><em>Loading more details...</em></p>}

      <RuleManager
        processedEmailsFromDashboard={processedEmails}
        currentActiveRules={activeRules}
        onApplyRuleAction={applyRuleAction}
        checkRuleCondition={checkRuleCondition}
        onRulesUpdated={loadRulesFromStorage} // Renamed from handleRefreshRulesAndEmails for clarity
      />

      <EmailViewer
        emails={processedEmails.filter(email => !email.isTrashed)} // Filter out trashed emails from main view
        isLoading={isLoading}
        error={null}
        onMarkAsReadUnread={handleMarkAsReadUnread}
        onArchiveUnarchive={handleArchiveUnarchive}
        onTrashUntrash={handleTrashUntrash}
        modifyingEmailId={modifyingEmailId}
        onDemandSummarize={handleOnDemandSummarize}
        currentSummary={currentOnDemandSummary}
      />
      {/* Error is handled above, EmailViewer doesn't need to re-display it unless it has its own errors */}

      {!isLoading && !processedEmails.filter(email => !email.isTrashed).length && accessToken && !error && (
        <p className="status-message">No emails found matching the current criteria (Default: Archived). Try refreshing or checking Gmail.</p>
      )}

      {!nextPageToken && messageIdList.length > 0 && !isLoading && (
        <p className="status-message">All available emails for the current query have been listed.</p>
      )}
       {!accessToken && !error && <p className="status-message">Please log in to view emails.</p>}
    </div>
  );
};

export default MainDashboard;
