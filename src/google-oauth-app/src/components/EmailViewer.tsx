import React from 'react';
import { ProcessedEmail } from '../types';
import './Dashboard.css'; // Import CSS

interface EmailViewerProps {
  emails: ProcessedEmail[];
  isLoading: boolean; // Keep isLoading to potentially show item-specific loading later
  error?: string | null; // Keep error for potential item-specific errors
  onMarkAsReadUnread: (emailId: string, currentStatus: boolean) => void;
  onArchiveUnarchive: (emailId: string, currentStatus: boolean) => void;
  onTrashUntrash: (emailId: string, currentStatus: boolean) => void;
  modifyingEmailId?: string | null;
}

const EmailViewer: React.FC<EmailViewerProps> = ({
  emails,
  onMarkAsReadUnread,
  onArchiveUnarchive,
  onTrashUntrash,
  modifyingEmailId,
  /*, isLoading, error */
}) => {
  // MainDashboard now handles the primary loading/error/empty states for the whole list.
  // EmailViewer will just render the items it receives.
  // If emails array is empty, it will render nothing, which is fine as MainDashboard shows "No emails".

  if (!emails || emails.length === 0) {
    return null; // Or a message like <p className="status-message">No emails to display in viewer.</p> if desired
  }

  return (
    <ul className="email-list-container">
      {emails.map(email => (
        <li key={email.id} className={`email-item ${email.isUnread ? 'unread' : ''}`}>
          <div className="subject">{email.subject || '(No Subject)'}</div>
          <div className="details">
            <span><strong>From:</strong> {email.sender}</span><br/>
            <span><strong>Date:</strong> {new Date(email.date).toLocaleString()}</span>
          </div>
          <p className="snippet">{email.snippet}</p>
          <p className="status">
            Status: {email.isUnread ? 'Unread' : 'Read'} | {email.isArchived ? 'Archived' : 'In Inbox'}
          </p>
          <div className="email-actions">
            <button
              onClick={() => onMarkAsReadUnread(email.id, email.isUnread)}
              disabled={modifyingEmailId === email.id}
            >
              {email.isUnread ? 'Mark as Read' : 'Mark as Unread'}
            </button>
            <button
              onClick={() => onArchiveUnarchive(email.id, email.isArchived)}
              disabled={modifyingEmailId === email.id}
            >
              {email.isArchived ? 'Move to Inbox' : 'Archive'}
            </button>
            <button
              onClick={() => onTrashUntrash(email.id, email.isTrashed)}
              disabled={modifyingEmailId === email.id}
            >
              {email.isTrashed ? 'Untrash & Move to Inbox' : 'Trash'}
            </button>
            {modifyingEmailId === email.id && <span className="action-loading">Processing...</span>}
          </div>
          {/*
          <details>
            <summary>Body (Plain Text)</summary>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '200px', overflowY: 'auto', backgroundColor: '#f9f9f9', padding: '5px' }}>
              {email.bodyPlain || "No plain text body available."}
            </pre>
          </details>
          <details>
            <summary>Labels</summary>
            <p>{email.labelIds.join(', ')}</p>
          </details>
          */}
        </li>
      ))}
    </ul>
  );
};

export default EmailViewer;
