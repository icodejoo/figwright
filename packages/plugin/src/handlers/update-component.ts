import type { SandboxToolHandler } from '../dispatcher.js';

/**
 * Whether the text parses as an absolute URL. The plugin sandbox is not guaranteed to have the URL
 * global (measured: absent), so without it fall back to a scheme-and-no-whitespace check. The `//`
 * is not required: mailto: and tel: links are absolute URIs too, and Figma has the final say.
 */
const isAbsoluteUrl = (uri: string): boolean => {
  if (typeof URL === 'function') {
    try {
      return Boolean(new URL(uri));
    } catch {
      return false;
    }
  }
  return /^[a-z][a-z0-9+.-]*:\S+$/i.test(uri);
};

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const createUpdateComponentHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = params as {
      componentId: string;
      description?: string;
      descriptionMarkdown?: string;
      documentationLinks?: DocumentationLink[];
    };
    if (p.description !== undefined && p.descriptionMarkdown !== undefined) {
      throw new Error(
        'update_component: supply description or descriptionMarkdown, not both (Figma synchronizes them)',
      );
    }
    if (
      p.description === undefined &&
      p.descriptionMarkdown === undefined &&
      p.documentationLinks === undefined
    ) {
      throw new Error('update_component: supply a description or documentationLinks');
    }
    if (p.documentationLinks !== undefined && p.documentationLinks.length > 1) {
      throw new Error('update_component: Figma supports at most one documentation link');
    }
    // A link Figma would refuse is caught here, before any write: uri must be an absolute URL.
    for (const link of p.documentationLinks ?? []) {
      if (!isAbsoluteUrl(link.uri)) {
        throw new Error(
          `update_component: documentationLinks uri ${JSON.stringify(link.uri)} is not a valid URL`,
        );
      }
    }
    const node = await figmaCtx.getNodeByIdAsync(p.componentId);
    if (node?.type !== 'COMPONENT' && node?.type !== 'COMPONENT_SET') {
      throw new Error(`update_component: ${p.componentId} is not a component or component set`);
    }
    if (node.remote) throw new Error('update_component: remote components are read-only');
    const before = { description: node.description, descriptionMarkdown: node.descriptionMarkdown };
    if (p.description !== undefined) node.description = p.description;
    if (p.descriptionMarkdown !== undefined) node.descriptionMarkdown = p.descriptionMarkdown;
    if (p.documentationLinks !== undefined) {
      try {
        node.documentationLinks = p.documentationLinks;
      } catch (linkError) {
        // The links were refused after the description landed: put the description back, so the
        // call changes nothing. If even that fails, say so — both errors matter.
        try {
          if (p.descriptionMarkdown !== undefined || p.description !== undefined) {
            node.descriptionMarkdown = before.descriptionMarkdown;
          }
        } catch (restoreError) {
          throw new Error(
            `update_component: documentationLinks was refused (${errorText(linkError)}) and the ` +
              `description could not be restored (${errorText(restoreError)}); the component ` +
              'now carries the new description',
            { cause: restoreError },
          );
        }
        throw linkError;
      }
    }
    return { ok: true, componentId: node.id };
  };
