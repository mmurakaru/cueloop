import Base

type Turn is Data:
  Idle{}
  Starting{cancelled: Bool}
  Running{}
  Stopping{}

type TurnEvent is Data:
  Start{}
  Ready{}
  Stop{}
  Finished{}

# Initialization cancellation is remembered only until readiness settles it.
def step(event: TurnEvent, state: Turn) -> Turn:
  match event:
    case Start{}:
      match state:
        case Idle{}: Starting{False{}}
        case Starting{cancelled}: Starting{cancelled}
        case Running{}: Running{}
        case Stopping{}: Stopping{}
    case Ready{}:
      match state:
        case Idle{}: Idle{}
        case Starting{cancelled}:
          match cancelled:
            case False{}: Running{}
            case True{}: Idle{}
        case Running{}: Running{}
        case Stopping{}: Stopping{}
    case Stop{}:
      match state:
        case Idle{}: Idle{}
        case Starting{cancelled}: Starting{True{}}
        case Running{}: Stopping{}
        case Stopping{}: Stopping{}
    case Finished{}: Idle{}
