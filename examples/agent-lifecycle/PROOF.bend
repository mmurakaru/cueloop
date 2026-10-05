import Base
import ./turn.bend as Turn
import ./LAWS.bend as Laws

def Laws.cancelled_start_recovers(cancelled):
  match cancelled:
    case False{}: {==}
    case True{}: {==}

def Laws.stopped_turn_recovers(state):
  match state:
    case Turn.Idle{}: {==}
    case Turn.Starting{cancelled}: {==}
    case Turn.Running{}: {==}
    case Turn.Stopping{}: {==}
