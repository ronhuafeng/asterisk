import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import {
  GmailMessage,
  GmailListResponse,
  MessagePartHeader,
  MessagePart,
  FullGmailMessage,
  ProcessedEmail
} from '../types'; // Import types from types.ts
import EmailViewer from './EmailViewer';
import './Dashboard.css'; // Import CSS

const MainDashboard: React.FC = () => {
  const { accessToken } = useAuth();
  const [messageIdList, setMessageIdList] = useState<GmailMessage[]>([]);
  const [processedEmails, setProcessedEmails] = useState<ProcessedEmail[]>([]); // Stores detailed and parsed emails
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined);
  const [isLoadingList, setIsLoadingList] = useState<boolean>(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

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

    // If clearing existing, do it before starting new fetches
    if (clearExistingDetails) {
      setProcessedEmails([]);
    }

    const newProcessedEmails: ProcessedEmail[] = [];
    for (const messageInfo of messagesToFetch) {
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

        newProcessedEmails.push({ // Corrected variable name
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
          labelIds: fullMessage.labelIds,
        });
      } catch (detailErr: any) {
        console.warn(`Error processing message ${messageInfo.id}:`, detailErr.message);
        // Optionally add a placeholder or error object to newProcessedEmails for this ID
      }
    }

    setProcessedEmails(prevDetails => clearExistingDetails ? newProcessedEmails : [...prevDetails, ...newProcessedEmails]);
    setIsLoadingDetails(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]); // getHeader, parseEmailBody are stable if defined outside or useCallback. Added accessToken


  useEffect(() => {
    if (accessToken) {
      // Initial fetch of message IDs when accessToken becomes available
      // The fetchMessageIds function will then call fetchAndProcessDetails
      setMessageIdList([]); // Clear any old IDs
      setProcessedEmails([]); // Clear any old processed emails
      setNextPageToken(undefined); // Reset pagination
      setError(null); // Clear previous errors
      fetchMessageIds();
    } else {
      // Clear all data if accessToken is lost (logout)
      setMessageIdList([]);
      setProcessedEmails([]);
      setNextPageToken(undefined);
      setError(null);
      setIsLoadingList(false);
      setIsLoadingDetails(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, fetchMessageIds]); // Added fetchMessageIds as a dependency

  const handleRefreshEmails = () => {
    // Clear all states and fetch first page of IDs, which then fetches their details
    setMessageIdList([]);
    setProcessedEmails([]);
    setNextPageToken(undefined);
    setError(null);
    if (accessToken) {
        fetchMessageIds();
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


      <EmailViewer emails={processedEmails} isLoading={isLoading} error={null} />
      {/* Error is handled above, EmailViewer doesn't need to re-display it unless it has its own errors */}

      {!isLoading && !processedEmails.length && accessToken && !error && (
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
