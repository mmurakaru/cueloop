import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { AnnotationCard } from "./AnnotationCard";

export const meta: StoryMeta = { title: "AnnotationCard" };

const draftCallbacks = { onInput: () => {}, onSave: () => {}, onCancel: () => {} };

export const CommentDraft: Story = {
  render: () => (
    <AnnotationCard kind="comment" quote="persists sessions" draft={{ text: "Which daemon?", ...draftCallbacks }} />
  ),
  expectedColors: [DARK.accent, DARK.elevated],
};

export const SuggestionDraft: Story = {
  render: () => (
    <AnnotationCard kind="suggestion" quote="move the store" draft={{ text: "", ...draftCallbacks }} />
  ),
  expectedColors: [DARK.green],
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
        editing: null,
        onPress: () => {},
      }}
    />
  ),
  expectedColors: [DARK.elevated],
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
        editing: null,
        onPress: () => {},
      }}
    />
  ),
  expectedColors: [DARK.red],
};

export const SavedEditing: Story = {
  render: () => (
    <AnnotationCard
      kind="suggestion"
      quote="move the store"
      saved={{
        body: "old body",
        isSelected: true,
        isOrphan: false,
        isBlocking: false,
        editing: { text: "new body", ...draftCallbacks },
        onPress: () => {},
      }}
    />
  ),
};
