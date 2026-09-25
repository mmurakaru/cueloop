/** The public document representation selected from an HTTP Accept header. */
export type DocumentRepresentation = "html" | "markdown" | "not-acceptable";

interface AcceptedMediaType {
  mediaType: string;
  quality: number;
  order: number;
}

interface RepresentationPreference {
  representation: Exclude<DocumentRepresentation, "not-acceptable">;
  quality: number;
  order: number;
}

function parseQuality(parameter: string): number | null {
  const [name, rawValue] = parameter.split("=", 2).map((part) => part.trim());

  if (name?.toLowerCase() !== "q" || rawValue === undefined) return null;
  const quality = Number(rawValue);

  return Number.isFinite(quality) && quality >= 0 && quality <= 1 ? quality : 0;
}

function parseAcceptedMediaTypes(accept: string): AcceptedMediaType[] {
  return accept.split(",").map((entry, order) => {
    const [rawMediaType = "", ...parameters] = entry.split(";");
    const quality = parameters
      .map(parseQuality)
      .find((candidate): candidate is number => candidate !== null);

    return {
      mediaType: rawMediaType.trim().toLowerCase(),
      quality: quality ?? 1,
      order,
    };
  });
}

function mediaTypeSpecificity(accepted: string, offered: string): number | null {
  if (accepted === offered) return 2;
  const [offeredType] = offered.split("/", 1);
  if (accepted === `${offeredType}/*`) return 1;
  if (accepted === "*/*") return 0;

  return null;
}

function representationPreference(
  acceptedTypes: AcceptedMediaType[],
  representation: Exclude<DocumentRepresentation, "not-acceptable">,
  mediaType: string,
): RepresentationPreference {
  const match = acceptedTypes
    .map((accepted) => ({
      ...accepted,
      specificity: mediaTypeSpecificity(accepted.mediaType, mediaType),
    }))
    .filter(
      (accepted): accepted is AcceptedMediaType & { specificity: number } =>
        accepted.specificity !== null,
    )
    .toSorted((left, right) => right.specificity - left.specificity || left.order - right.order)[0];

  return {
    representation,
    quality: match?.quality ?? 0,
    order: match?.order ?? Number.MAX_SAFE_INTEGER,
  };
}

/** Chooses the HTML or Markdown document representation from an HTTP Accept header. */
export function negotiateDocumentContent(accept: string | null): DocumentRepresentation {
  if (accept === null || accept.trim() === "") return "html";

  const acceptedTypes = parseAcceptedMediaTypes(accept);
  const candidates = [
    representationPreference(acceptedTypes, "html", "text/html"),
    representationPreference(acceptedTypes, "markdown", "text/markdown"),
  ]
    .filter((candidate) => candidate.quality > 0)
    .toSorted((left, right) => right.quality - left.quality || left.order - right.order);

  return candidates[0]?.representation ?? "not-acceptable";
}
