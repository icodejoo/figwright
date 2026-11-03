import type { VariableResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/** The variable as it now stands — the metadata the call can change, echoed back. */
const describeVariable = (variable: Variable): VariableResult => ({
  ok: true,
  variableId: variable.id,
  name: variable.name,
  description: variable.description,
  scopes: [...variable.scopes],
  hiddenFromPublishing: variable.hiddenFromPublishing,
});

/**
 * Edit a variable's description / scopes / hiddenFromPublishing in place. Nothing about the id, the
 * values or the bindings changes, which is the point: a mis-scoped token used to be fixable only by
 * deleting and recreating it.
 *
 * The three writes are all-or-nothing. Figma refuses a scope that does not fit the type ("Invalid
 * scope for this variable type", any scope on EASING / TIMING) and refuses hiding a library
 * variable, and either can come after another field was already written, so each is applied in turn
 * and the ones already applied are put back if a later one throws.
 */
export const createUpdateVariableHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      variableId?: unknown;
      description?: unknown;
      scopes?: unknown;
      hiddenFromPublishing?: unknown;
    };
    if (typeof p.variableId !== 'string') {
      throw new TypeError('update_variable: variableId must be a string');
    }
    if (p.description !== undefined && typeof p.description !== 'string') {
      throw new TypeError('update_variable: description must be a string');
    }
    if (p.hiddenFromPublishing !== undefined && typeof p.hiddenFromPublishing !== 'boolean') {
      throw new TypeError('update_variable: hiddenFromPublishing must be a boolean');
    }
    // An empty array would clear every scope, which Figma reads as "offered nowhere".
    if (
      p.scopes !== undefined &&
      (!Array.isArray(p.scopes) ||
        p.scopes.length === 0 ||
        p.scopes.some(scope => typeof scope !== 'string'))
    ) {
      throw new TypeError('update_variable: scopes must be a non-empty array of scope names');
    }

    const variable = await figmaCtx.variables.getVariableByIdAsync(p.variableId);
    if (variable === null) throw new Error(`update_variable: variable ${p.variableId} not found`);

    const was = {
      description: variable.description,
      scopes: [...variable.scopes],
      hiddenFromPublishing: variable.hiddenFromPublishing,
    };
    try {
      if (typeof p.description === 'string') variable.description = p.description;
      if (p.scopes !== undefined) variable.scopes = p.scopes as VariableScope[];
      if (typeof p.hiddenFromPublishing === 'boolean') {
        variable.hiddenFromPublishing = p.hiddenFromPublishing;
      }
    } catch (error) {
      try {
        variable.description = was.description;
        variable.scopes = was.scopes;
        variable.hiddenFromPublishing = was.hiddenFromPublishing;
      } catch {
        // Best effort — the refusal below is the failure worth reporting.
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `update_variable: Figma refused the change to ${variable.name} (${reason}); nothing was ` +
          'changed. Scopes must fit the variable type (EASING / TIMING take none), and only local ' +
          'variables can be hidden from publishing.',
        { cause: error },
      );
    }
    return describeVariable(variable);
  };
