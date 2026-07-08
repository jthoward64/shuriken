/** Shared options threaded from the router into chrome-capable UI page
 * handlers (calendar/contacts/tasks). "embed" renders the chrome-less variant
 * for iframing (see Layout). */
export interface UiPageOpts {
	readonly chrome?: "full" | "embed";
}
