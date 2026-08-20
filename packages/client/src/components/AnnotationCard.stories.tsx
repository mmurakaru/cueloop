import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { AnnotationCard } from "./AnnotationCard";

export const meta: StoryMeta = { title: "AnnotationCard" };

const draftCallbacks = { onInput: () => {}, onSave: () => {}, onCancel: () => {} };

export const CommentDraft: Story = {
  render: () => (
    <AnnotationCard
      kind="comment"
      quote="persists sessions"
      draft={{ text: "Which daemon?", ...draftCallbacks }}
    />
  ),
  expectedColors: [DARK.accent],
};

export const SavedSelected: Story = {
  render: () => (
    <AnnotationCard
      kind="comment"
      quote="persists sessions"
      saved={{
        body: "Which daemon owns this?",
        isSelected: true,
        isOrphan: false,
        isBlocking: false,
        author: "me",
        editing: null,
        onPress: () => {},
      }}
    />
  ),
  expectedColors: [DARK.elevated],
};

export const SavedCollaborator: Story = {
  render: () => (
    <AnnotationCard
      kind="comment"
      quote="persists sessions"
      saved={{
        body: "Which daemon owns this?",
        isSelected: false,
        isOrphan: false,
        isBlocking: false,
        author: "Priya",
        editing: null,
        onPress: () => {},
      }}
    />
  ),
  expectedColors: [DARK.accent],
};

export const SavedOrphanBlocking: Story = {
  render: () => (
    <AnnotationCard
      kind="comment"
      quote="a removed passage"
      saved={{
        body: "The passage is gone.",
        isSelected: false,
        isOrphan: true,
        isBlocking: true,
        author: "me",
        editing: null,
        onPress: () => {},
      }}
    />
  ),
  expectedColors: [DARK.accent],
};

export const SavedEditing: Story = {
  render: () => (
    <AnnotationCard
      kind="comment"
      quote="move the store"
      saved={{
        body: "old body",
        isSelected: true,
        isOrphan: false,
        isBlocking: false,
        author: "me",
        editing: { text: "new body", ...draftCallbacks },
        onPress: () => {},
      }}
    />
  ),
};
