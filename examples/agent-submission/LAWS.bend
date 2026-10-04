import Base
import ./submission.bend as S

# Empty invocation never changes the submission state.
law empty_input_is_noop:
  for +state: S.Status
  {S.step(S.Submit{}, state, False{}) == state : S.Status}

# Editing never rewrites an accepted submission.
law edits_preserve_state:
  for +state: S.Status
  {S.step(S.Edit{}, state, True{}) == state : S.Status}

# Every event preserves the lock once input has entered the queue.
law queued_input_stays_locked:
  for event: S.SubmissionEvent
  for input: Bool
  {S.locked(S.step(event, S.Queued{}, input)) == True{} : Bool}

# Retry returns to the queue without making input editable.
law retry_stays_locked:
  {S.locked(S.step(S.Retry{}, S.Failed{}, True{})) == True{} : Bool}

law running_input_stays_locked:
  for event: S.SubmissionEvent
  for input: Bool
  {S.locked(S.step(event, S.Running{}, input)) == True{} : Bool}

law completed_input_stays_locked:
  for event: S.SubmissionEvent
  for input: Bool
  {S.locked(S.step(event, S.Completed{}, input)) == True{} : Bool}

law failed_input_stays_locked:
  for event: S.SubmissionEvent
  for input: Bool
  {S.locked(S.step(event, S.Failed{}, input)) == True{} : Bool}
