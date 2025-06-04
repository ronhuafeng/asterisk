import React, { useState, useEffect } from 'react';
import { Rule, ProcessedEmail, RuleManagerProps } from '../types'; // Import ProcessedEmail and RuleManagerProps
import { toast } from 'react-toastify'; // For notifications
import './RuleManager.css';

const RuleManager: React.FC<RuleManagerProps> = ({
  processedEmailsFromDashboard,
  currentActiveRules, // Use this for "Apply All" to reflect MainDashboard's state of rules
  onApplyRuleAction,
  checkRuleCondition,
  onRulesUpdated,
}) => {
  const [rules, setRules] = useState<Rule[]>([]); // Rules managed by this component, synced to localStorage for editing
  const [newRuleName, setNewRuleName] = useState('');
  const [newConditionType, setNewConditionType] = useState<'sender' | 'bodyKeywords' | 'aiPrompt'>('sender');
  const [newAiPromptTarget, setNewAiPromptTarget] = useState<'sender' | 'body' | 'subject'>('body'); // New state for AI prompt target
  const [newConditionValue, setNewConditionValue] = useState('');
  const [newActionType, setNewActionType] = useState<'summarize' | 'archive' | 'markRead' | 'addLabel'>('archive');
  const [newActionValue, setNewActionValue] = useState('');
  const [isApplyingRules, setIsApplyingRules] = useState(false);
  const [apiEndpoint, setApiEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');

  // Load AI config from local storage
  useEffect(() => {
    const storedEndpoint = localStorage.getItem('aiApiEndpoint');
    const storedKey = localStorage.getItem('aiApiKey');
    if (storedEndpoint) setApiEndpoint(storedEndpoint);
    if (storedKey) setApiKey(storedKey);
  }, []);

  // Save AI config to local storage
  useEffect(() => {
    localStorage.setItem('aiApiEndpoint', apiEndpoint);
  }, [apiEndpoint]);

  useEffect(() => {
    localStorage.setItem('aiApiKey', apiKey);
  }, [apiKey]);

  const handleApplyAllRules = async () => {
    setIsApplyingRules(true);
    // Individual actions will show toasts on error by default from onApplyRuleAction.
    // We will show a summary at the end.
    // Temporarily suppress individual success toasts from onApplyRuleAction if desired, by passing a flag or context.
    // For now, individual success toasts from onApplyRuleAction (manual run) are OK.
    console.log(`Starting to apply ${currentActiveRules.length} active rule(s) to ${processedEmailsFromDashboard.length} email(s)...`);

    let rulesAppliedSuccessfullyCount = 0;
    let rulesEncounteredErrorCount = 0;
    let emailsAffectedCount = 0;

    for (const email of processedEmailsFromDashboard) {
      let emailWasModifiedInThisIteration = false;
      let previousEmailState = { ...email }; // Store initial state of email for this iteration

      for (const rule of currentActiveRules) {
        const ruleMatched = await checkRuleCondition(previousEmailState, rule); // Use previousEmailState for check
        if (ruleMatched) {
          const updatedEmail = await onApplyRuleAction(rule, previousEmailState, true); // Pass true for manual run
          if (updatedEmail) {
            // Check if a meaningful change occurred by comparing key properties
            const changed = updatedEmail.isUnread !== previousEmailState.isUnread ||
                            updatedEmail.isArchived !== previousEmailState.isArchived ||
                            updatedEmail.summary !== previousEmailState.summary ||
                            JSON.stringify([...updatedEmail.labelIds].sort()) !== JSON.stringify([...previousEmailState.labelIds].sort());

            if (changed) {
              rulesAppliedSuccessfullyCount++;
              emailWasModifiedInThisIteration = true;
            }
            previousEmailState = updatedEmail; // Important: update email state for the next rule in sequence
          } else {
            // Action might have failed if updatedEmail is null
            rulesEncounteredErrorCount++;
          }
        }
      }
      if (emailWasModifiedInThisIteration) {
        emailsAffectedCount++;
      }
    }

    if (rulesEncounteredErrorCount > 0) {
        toast.error(`Rule application finished. ${rulesAppliedSuccessfullyCount} actions succeeded, but ${rulesEncounteredErrorCount} errors were encountered. ${emailsAffectedCount} email(s) were affected.`);
    } else if (rulesAppliedSuccessfullyCount > 0) {
        toast.success(`Rule application finished. ${rulesAppliedSuccessfullyCount} actions successfully applied to ${emailsAffectedCount} email(s).`);
    } else {
        toast.info("Rule application finished. No rules resulted in changes to the loaded emails.");
    }
    setIsApplyingRules(false);
  };

  // Load rules from local storage on mount for this component's internal management (editing list)
  useEffect(() => {
    const storedRules = localStorage.getItem('emailRules');
    if (storedRules) {
      try {
        setRules(JSON.parse(storedRules));
      } catch (e) {
        console.error("Failed to parse rules from localStorage in RuleManager", e);
        toast.error("Failed to load rules into RuleManager. Storage might be corrupted.");
      }
    }
  }, []);

  // Save rules to local storage when this component's `rules` state changes
  // And notify MainDashboard to potentially reload its activeRules state
  useEffect(() => {
    localStorage.setItem('emailRules', JSON.stringify(rules));
    if (onRulesUpdated) {
      onRulesUpdated();
    }
  }, [rules, onRulesUpdated]);

  const handleAddRule = () => {
    if (!newRuleName.trim() || !newConditionValue.trim()) {
      toast.warn('Rule name and condition value are required.');
      return;
    }
    if (newActionType === 'addLabel' && !newActionValue.trim()) {
      toast.warn('Label name is required for "addLabel" action.');
      return;
    }

    const ruleToAdd: Rule = {
      id: Date.now().toString(), // Simple unique ID
      name: newRuleName,
      conditionType: newConditionType,
      conditionValue: newConditionValue,
      actionType: newActionType,
      actionValue: newActionType === 'addLabel' ? newActionValue : undefined,
    };

    if (newConditionType === 'aiPrompt') {
      ruleToAdd.aiPromptTarget = newAiPromptTarget;
    }

    setRules(prevRules => [...prevRules, ruleToAdd]);
    // Clear input fields
    setNewRuleName('');
    setNewConditionValue('');
    setNewActionValue('');
  };

  const handleDeleteRule = (ruleId: string) => {
    setRules(prevRules => prevRules.filter(rule => rule.id !== ruleId));
  };


  let conditionPlaceholder = "Enter value";
  if (newConditionType === 'sender') conditionPlaceholder = "e.g., sender@example.com";
  else if (newConditionType === 'bodyKeywords') conditionPlaceholder = "e.g., important, urgent";
  else if (newConditionType === 'aiPrompt') conditionPlaceholder = "e.g., Is this email a newsletter?";

  return (
    <div className="rule-manager">
      <h3>Email Rule Manager</h3>

      <div className="ai-config-form section-container">
        <h4>AI Summarization Configuration</h4>
        <p style={{color: 'red', fontSize: '0.9em'}}>
          <strong>Warning:</strong> API keys are stored in your browser's local storage.
          This is not secure for production use. Avoid using highly sensitive keys.
        </p>
        <div>
          <label htmlFor="apiEndpoint">API Endpoint:</label>
          <input
            id="apiEndpoint"
            type="text"
            placeholder="OpenAI-compatible API Endpoint"
            value={apiEndpoint}
            onChange={e => setApiEndpoint(e.target.value)}
            style={{width: '300px', marginRight: '10px'}}
          />
        </div>
        <div>
          <label htmlFor="apiKey">API Key:</label>
          <input
            id="apiKey"
            type="password"
            placeholder="API Key"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            style={{width: '300px'}}
          />
        </div>
      </div>

      {/* Form to add new rule */}
      <div className="rule-form section-container">
        <h4>Create New Rule</h4>
        <input type="text" placeholder="Rule Name" value={newRuleName} onChange={e => setNewRuleName(e.target.value)} />
        <select value={newConditionType} onChange={e => setNewConditionType(e.target.value as 'sender' | 'bodyKeywords' | 'aiPrompt')}>
          <option value="sender">Sender CONTAINS</option>
          <option value="bodyKeywords">Body CONTAINS Keywords (comma-sep)</option>
          <option value="aiPrompt">AI Prompt Evaluates (Yes/No)</option>
        </select>
        {newConditionType === 'aiPrompt' && (
          <select value={newAiPromptTarget} onChange={e => setNewAiPromptTarget(e.target.value as 'sender' | 'body' | 'subject')} title="AI Prompt Target">
            <option value="body">On Email Body</option>
            <option value="subject">On Subject</option>
            <option value="sender">On Sender</option>
          </select>
        )}
        <input type="text" placeholder={conditionPlaceholder} value={newConditionValue} onChange={e => setNewConditionValue(e.target.value)} />
        <select value={newActionType} onChange={e => setNewActionType(e.target.value as 'summarize' | 'archive' | 'markRead' | 'addLabel')}>
          <option value="archive">Archive</option>
          <option value="markRead">Mark as Read</option>
          <option value="addLabel">Add Label</option>
          <option value="summarize">Summarize (AI)</option>
        </select>
        {newActionType === 'addLabel' && (
          <input type="text" placeholder="Label Name" value={newActionValue} onChange={e => setNewActionValue(e.target.value)} />
        )}
        <button onClick={handleAddRule}>Add Rule</button>
      </div>

      {/* List of existing rules */}
      <div className="rule-list section-container">
        <h4>Defined Rules</h4>
        {rules.length === 0 ? <p>No rules defined yet.</p> : (
          <ul>
            {rules.map(rule => (
              <li key={rule.id}>
                <span>
                  <strong>{rule.name}</strong>:
                  IF {rule.conditionType}
                  {rule.conditionType === 'aiPrompt' && rule.aiPromptTarget && ` (Target: ${rule.aiPromptTarget})`}
                  &nbsp;"{rule.conditionValue}"
                  THEN {rule.actionType} {rule.actionType === 'addLabel' ? `"${rule.actionValue}"` : ''}
                </span>
                <button onClick={() => handleDeleteRule(rule.id)} className="delete-rule-btn">Delete</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="manual-apply-rules">
        <h4>Manual Control</h4>
        <button
          onClick={handleApplyAllRules}
          disabled={isApplyingRules || currentActiveRules.length === 0 || processedEmailsFromDashboard.length === 0}
        >
          {isApplyingRules ? 'Applying Rules...' : `Apply ${currentActiveRules.length} Active Rule(s) to ${processedEmailsFromDashboard.length} Email(s)`}
        </button>
        {currentActiveRules.length === 0 && <p><small>No active rules loaded to apply.</small></p>}
        {processedEmailsFromDashboard.length === 0 && currentActiveRules.length > 0 && <p><small>No emails currently loaded in MainDashboard to apply rules to.</small></p>}
      </div>
    </div>
  );
};

export default RuleManager;
