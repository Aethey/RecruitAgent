/** Selectors in this application target authored HTML, rather than SVG nodes. */
export function element<K extends keyof HTMLElementTagNameMap>(selector: K, root?: ParentNode | null): HTMLElementTagNameMap[K] | null;
export function element(selector: string, root?: ParentNode | null): HTMLElement | null;
export function element(selector: string, root: ParentNode | null = document): HTMLElement | null { return (root?.querySelector(selector) ?? null) as HTMLElement | null; }
export function elements<K extends keyof HTMLElementTagNameMap>(selector: K, root?: ParentNode): NodeListOf<HTMLElementTagNameMap[K]>;
export function elements(selector: string, root?: ParentNode): NodeListOf<HTMLElement>;
export function elements(selector: string, root: ParentNode = document): NodeListOf<HTMLElement> { return root.querySelectorAll(selector) as NodeListOf<HTMLElement>; }
