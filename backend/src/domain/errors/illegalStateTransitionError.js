/**
 * IllegalStateTransitionException - thrown when attempting an illegal state transition.
 */

export class IllegalStateTransitionError extends Error {
  constructor(fromState, toState) {
    super(`Illegal state transition: ${fromState} -> ${toState}`);
    this.name = 'IllegalStateTransitionError';
    this.fromState = fromState;
    this.toState = toState;
  }
}
