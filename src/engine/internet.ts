/** network.internet.state from @meri-imperiumi/signalk-internet. */
export const INTERNET_PATH = 'network.internet.state'

export type InternetState = 'online' | 'metered' | 'offline' | 'captive' | 'unknown'

export function internetState(value: unknown): InternetState {
  return value === 'online' || value === 'metered' || value === 'offline' || value === 'captive' ? value : 'unknown'
}

/** Whether to try the internet now. Without signalk-internet the state is unknown and we try. */
export function mayUseInternet(state: InternetState): boolean {
  return state !== 'offline' && state !== 'captive'
}
