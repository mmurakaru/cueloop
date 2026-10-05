import Base
import ./submission.bend as S
import ./LAWS.bend as Laws

def Laws.empty_input_is_noop(state):
  match state:
    case S.Draft{}: {==}
    case S.Queued{}: {==}
    case S.Running{}: {==}
    case S.Completed{}: {==}
    case S.Failed{}: {==}

def Laws.edits_preserve_state(state):
  {==}

def Laws.queued_input_stays_locked(event, input):
  match event:
    case S.Submit{}: {==}
    case S.Start{}: {==}
    case S.Complete{}: {==}
    case S.FailTurn{}: {==}
    case S.Retry{}: {==}
    case S.Edit{}: {==}

def Laws.retry_stays_locked():
  {==}

def Laws.running_input_stays_locked(event, input):
  match event:
    case S.Submit{}: {==}
    case S.Start{}: {==}
    case S.Complete{}: {==}
    case S.FailTurn{}: {==}
    case S.Retry{}: {==}
    case S.Edit{}: {==}

def Laws.completed_input_stays_locked(event, input):
  match event:
    case S.Submit{}: {==}
    case S.Start{}: {==}
    case S.Complete{}: {==}
    case S.FailTurn{}: {==}
    case S.Retry{}: {==}
    case S.Edit{}: {==}

def Laws.failed_input_stays_locked(event, input):
  match event:
    case S.Submit{}: {==}
    case S.Start{}: {==}
    case S.Complete{}: {==}
    case S.FailTurn{}: {==}
    case S.Retry{}: {==}
    case S.Edit{}: {==}


def Laws.prompt_input_is_plain(selected):
  {==}

def Laws.unmarked_text_is_no_input():
  {==}

def Laws.marked_text_is_comment():
  {==}
