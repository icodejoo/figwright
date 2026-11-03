import type { ComponentPropertyResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import {
  type AuthorablePropertyType,
  PROPERTY_TYPES,
  resolveComponentOwner,
} from './component-property.js';

/**
 * Declare a BOOLEAN / TEXT / INSTANCE_SWAP property on a component (or its set). The property is
 * inert until bound to a sublayer field with bind_component_property; this handler only creates the
 * declaration and returns its Figma-assigned id ("name#id"), the handle every later
 * bind/edit/delete needs.
 */
export const createAddComponentPropertyHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      componentId?: unknown;
      name?: unknown;
      type?: unknown;
      defaultValue?: unknown;
      preferredValues?: unknown;
      description?: string;
      slotSettings?: SlotSettings;
    };
    if (typeof p.componentId !== 'string') {
      throw new TypeError('add_component_property: componentId must be a string');
    }
    if (typeof p.name !== 'string' || p.name.length === 0) {
      throw new TypeError('add_component_property: name must be a non-empty string');
    }
    if (p.type !== 'SLOT' && !PROPERTY_TYPES.includes(p.type as AuthorablePropertyType)) {
      throw new TypeError(
        `add_component_property: type must be one of ${PROPERTY_TYPES.join(' / ')} ` +
          '(VARIANT properties come from combine_as_variants)',
      );
    }
    const type = p.type as AuthorablePropertyType | 'SLOT';

    // defaultValue must match the type: BOOLEAN → boolean, TEXT → string, INSTANCE_SWAP → a
    // component key string. A mismatch is the easy caller error, so reject it with a precise message.
    if (type === 'BOOLEAN' && typeof p.defaultValue !== 'boolean') {
      throw new TypeError(
        'add_component_property: a BOOLEAN property needs a boolean defaultValue',
      );
    }
    if ((type === 'TEXT' || type === 'INSTANCE_SWAP') && typeof p.defaultValue !== 'string') {
      throw new TypeError(
        `add_component_property: a ${type} property needs a string defaultValue` +
          (type === 'INSTANCE_SWAP' ? ' (a component key)' : ''),
      );
    }
    if (type === 'SLOT' && p.defaultValue !== '') {
      throw new TypeError(
        'add_component_property: a SLOT property needs an empty string defaultValue',
      );
    }
    if ((p.description !== undefined || p.slotSettings !== undefined) && type !== 'SLOT') {
      throw new TypeError('add_component_property: description and slotSettings are SLOT only');
    }
    if (p.preferredValues !== undefined && type !== 'INSTANCE_SWAP' && type !== 'SLOT') {
      throw new TypeError(
        'add_component_property: preferredValues is only valid for an INSTANCE_SWAP or SLOT property',
      );
    }

    const node = await figmaCtx.getNodeByIdAsync(p.componentId);
    if (node === null) throw new Error(`add_component_property: node ${p.componentId} not found`);
    const owner = resolveComponentOwner('add_component_property', node);

    const options: ComponentPropertyOptions = {};
    if (Array.isArray(p.preferredValues))
      options.preferredValues = p.preferredValues as InstanceSwapPreferredValue[];
    if (p.description !== undefined) options.description = p.description;
    if (p.slotSettings !== undefined) options.slotSettings = p.slotSettings;
    const propertyId = owner.addComponentProperty(
      p.name,
      type,
      p.defaultValue as string | boolean,
      Object.keys(options).length > 0 ? options : undefined,
    );

    const result: ComponentPropertyResult = {
      ok: true,
      componentId: owner.id,
      propertyId,
      name: p.name,
    };
    return result;
  };
