# cueloop

A review-session primitive for coding agents.

An agent submits an artifact - a plan, a diff - and blocks.
You review it in the browser, annotate the parts that need to change, and return a verdict.
Approvals let the agent proceed; denials carry your annotations back as structured feedback the agent acts on.

The primitive is deliberately small - create a session, read it, annotate it, resolve it - and the review view is designed to be extended: artifact types map to renderers, and renderers emit annotations.

Status: planning. The product plan is being worked as decision tickets on this repo's issues - see the issue labelled `wayfinder:map`.
