import Base

type Status is Data:
  Draft{}
  Queued{}
  Running{}
  Completed{}
  Failed{}

type SubmissionEvent is Data:
  Submit{}
  Start{}
  Complete{}
  FailTurn{}
  Retry{}
  Edit{}

def step(event: SubmissionEvent, state: Status, has_input: Bool) -> Status:
  match event:
    case Submit{}:
      match state:
        case Draft{}:
          match has_input:
            case True{}: Queued{}
            case False{}: Draft{}
        case other: other
    case Start{}:
      match state:
        case Queued{}: Running{}
        case other: other
    case Complete{}:
      match state:
        case Running{}: Completed{}
        case other: other
    case FailTurn{}:
      match state:
        case Running{}: Failed{}
        case other: other
    case Retry{}:
      match state:
        case Failed{}: Queued{}
        case other: other
    case Edit{}: state

def locked(state: Status) -> Bool:
  match state:
    case Draft{}: False{}
    case other: True{}
