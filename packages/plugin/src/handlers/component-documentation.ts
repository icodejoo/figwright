/**
 * New metadata is emitted only when nonempty; preserve the existing plain-description fields.
 * descriptionMarkdown is the same text as description unless it carries formatting, so it is
 * emitted only when it differs.
 */
export const componentDocumentation = (node: ComponentNode | ComponentSetNode) => ({
  ...(node.description ? { description: node.description } : {}),
  ...(node.descriptionMarkdown && node.descriptionMarkdown !== node.description
    ? { descriptionMarkdown: node.descriptionMarkdown }
    : {}),
  ...(node.documentationLinks?.length
    ? { documentationLinks: node.documentationLinks.map(link => ({ uri: link.uri })) }
    : {}),
});
