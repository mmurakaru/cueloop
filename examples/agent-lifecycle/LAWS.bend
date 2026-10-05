import Base
import ./turn.bend as Turn

# Any initialization cancellation can settle, then accept a fresh turn.
law cancelled_start_recovers:
  for cancelled: Bool
  {Turn.step(Turn.Start{}, Turn.step(Turn.Ready{}, Turn.step(Turn.Stop{}, Turn.Starting{cancelled}))) == Turn.Starting{False{}} : Turn.Turn}

# After a stop response, every phase accepts a fresh turn without a stale flag.
law stopped_turn_recovers:
  for state: Turn.Turn
  {Turn.step(Turn.Start{}, Turn.step(Turn.Finished{}, Turn.step(Turn.Stop{}, state))) == Turn.Starting{False{}} : Turn.Turn}
