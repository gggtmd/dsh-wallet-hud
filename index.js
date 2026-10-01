/**
 * Host half of the Wallet HUD bundle.
 *
 * The balance comes from the account Remote the desktop composition already
 * serves (`account.getBalance`), so this half owns no Host capability,
 * registers nothing, and holds no state. It exists because a bundle row
 * resolves to a package whose host export the Loader must import.
 */
export function apply() {}
