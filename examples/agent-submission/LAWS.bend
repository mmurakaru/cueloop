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


# The bottom prompt never becomes a comment, even when text is selected there.
law prompt_input_is_plain:
  for selected: Bool
  {S.input_target(True{}, selected) == S.PromptInput{} : S.InputTarget}

# Artifact text without a held selection cannot create a comment.
law unmarked_text_is_no_input:
  {S.input_target(False{}, False{}) == S.NoInput{} : S.InputTarget}

# A held artifact selection is the only new-comment input target.
law marked_text_is_comment:
  {S.input_target(False{}, True{}) == S.CommentInput{} : S.InputTarget}
