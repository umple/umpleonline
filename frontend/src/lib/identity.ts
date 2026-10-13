/**
 * Random display name and color for a collaborator's cursor.
 * useCollab sends this identity with the Yjs awareness state.
 */

const ADJECTIVES = [
  'Amber', 'Azure', 'Coral', 'Crimson', 'Ember', 'Golden', 'Jade', 'Maple',
  'Misty', 'Ocean', 'Pearl', 'Rusty', 'Sandy', 'Silver', 'Sunny', 'Violet',
]

const ANIMALS = [
  'Bear', 'Crane', 'Deer', 'Eagle', 'Falcon', 'Fox', 'Hawk', 'Heron',
  'Lynx', 'Otter', 'Owl', 'Panda', 'Raven', 'Swan', 'Tiger', 'Wolf',
]

const COLORS = [
  '#e06666', // red
  '#6fa8dc', // blue
  '#93c47d', // green
  '#f6b26b', // orange
  '#8e7cc3', // purple
  '#c27ba0', // pink
  '#76a5af', // teal
  '#d5a439', // gold
]

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export interface CollabIdentity {
  name: string
  color: string
}

export function generateIdentity(): CollabIdentity {
  return {
    name: `${pick(ADJECTIVES)} ${pick(ANIMALS)}`,
    color: pick(COLORS),
  }
}
