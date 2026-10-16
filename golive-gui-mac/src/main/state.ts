import type { TunnelState } from '../shared/types';

export function nextState(
  current: TunnelState,
  ev: 'activated' | 'deactivated' | 'detected_tunnel' | 'detected_clean',
): TunnelState {
  switch (ev) {
    case 'activated':
    case 'detected_tunnel':
      return 'active';
    case 'deactivated':
    case 'detected_clean':
      return 'inactive';
    default:
      return current;
  }
}
