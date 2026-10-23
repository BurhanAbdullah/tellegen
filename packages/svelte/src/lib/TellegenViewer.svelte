<script lang="ts">
	import TellegenProvider from './TellegenProvider.svelte';
	import TellegenShell from './TellegenShell.svelte';
	import type { TellegenUiOptions } from './context.svelte.js';

	let {
		apiBase,
		loadDefaultCases,
		docsHref,
		orgHref,
		orgLabel,
		showFooter,
		theme
	}: TellegenUiOptions = $props();
</script>

<TellegenProvider
	{apiBase}
	{loadDefaultCases}
	{docsHref}
	{orgHref}
	{orgLabel}
	{showFooter}
	{theme}
>
	<TellegenShell />
</TellegenProvider>
