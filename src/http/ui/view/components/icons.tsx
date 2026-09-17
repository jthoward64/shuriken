import type { JSX } from "preact";

// ---------------------------------------------------------------------------
// Icon set — small inline SVGs (stroke-based, currentColor). Callers pass sizing
// via `class` (e.g. `class="w-5 h-5"`); props spread last so callers can
// override any default.
// ---------------------------------------------------------------------------

type IconProps = JSX.SVGAttributes<SVGSVGElement>;

const Svg = ({ children, ...props }: IconProps) => (
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
		{...props}
	>
		{children}
	</svg>
);

export const IconChevronDown = (props: IconProps) => (
	<Svg {...props}>
		<path d="m6 9 6 6 6-6" />
	</Svg>
);

export const IconSun = (props: IconProps) => (
	<Svg {...props}>
		<circle cx="12" cy="12" r="4" />
		<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
	</Svg>
);

export const IconMoon = (props: IconProps) => (
	<Svg {...props}>
		<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
	</Svg>
);

export const IconCalendar = (props: IconProps) => (
	<Svg {...props}>
		<rect x="3" y="4" width="18" height="18" rx="2" />
		<path d="M16 2v4M8 2v4M3 10h18" />
	</Svg>
);

export const IconContacts = (props: IconProps) => (
	<Svg {...props}>
		<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
		<circle cx="12" cy="7" r="4" />
	</Svg>
);

export const IconShare = (props: IconProps) => (
	<Svg {...props}>
		<circle cx="18" cy="5" r="3" />
		<circle cx="6" cy="12" r="3" />
		<circle cx="18" cy="19" r="3" />
		<path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
	</Svg>
);

export const IconAdmin = (props: IconProps) => (
	<Svg {...props}>
		<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
	</Svg>
);

export const IconArrowRight = (props: IconProps) => (
	<Svg {...props}>
		<path d="M5 12h14M13 6l6 6-6 6" />
	</Svg>
);

export const IconCopy = (props: IconProps) => (
	<Svg {...props}>
		<rect x="9" y="9" width="13" height="13" rx="2" />
		<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
	</Svg>
);

export const IconCheck = (props: IconProps) => (
	<Svg {...props}>
		<path d="M20 6 9 17l-5-5" />
	</Svg>
);

export const IconPlus = (props: IconProps) => (
	<Svg {...props}>
		<path d="M12 5v14M5 12h14" />
	</Svg>
);

export const IconClose = (props: IconProps) => (
	<Svg {...props}>
		<path d="M18 6 6 18M6 6l12 12" />
	</Svg>
);

export const IconSearch = (props: IconProps) => (
	<Svg {...props}>
		<circle cx="11" cy="11" r="8" />
		<path d="m21 21-4.3-4.3" />
	</Svg>
);

export const IconMenu = (props: IconProps) => (
	<Svg {...props}>
		<path d="M4 6h16M4 12h16M4 18h16" />
	</Svg>
);

export const IconRss = (props: IconProps) => (
	<Svg {...props}>
		<path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16" />
		<circle cx="5" cy="19" r="1" />
	</Svg>
);

export const IconMail = (props: IconProps) => (
	<Svg {...props}>
		<rect x="2" y="4" width="20" height="16" rx="2" />
		<path d="m22 7-10 6L2 7" />
	</Svg>
);

export const IconKey = (props: IconProps) => (
	<Svg {...props}>
		<circle cx="7.5" cy="15.5" r="4.5" />
		<path d="m10.5 12.5 8.5-8.5M17 4l3 3M15 6l3 3" />
	</Svg>
);

export const IconExternalLink = (props: IconProps) => (
	<Svg {...props}>
		<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
	</Svg>
);

export const IconChevronLeft = (props: IconProps) => (
	<Svg {...props}>
		<path d="m15 18-6-6 6-6" />
	</Svg>
);

export const IconChevronRight = (props: IconProps) => (
	<Svg {...props}>
		<path d="m9 18 6-6-6-6" />
	</Svg>
);

// NOTE: no shared button/loading-state component exists yet (Agent 1 owns the
// shared component vocabulary in ui.tsx). This spinner paired with the
// `.htmx-indicator` base class is the local loading convention until that
// lands — fold this in if a shared <Spinner>/<Button loading> arrives.
export const IconEdit = (props: IconProps) => (
	<Svg {...props}>
		<path d="M12 20h9" />
		<path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
	</Svg>
);

export const IconSpinner = (props: IconProps) => (
	<Svg {...props}>
		<path d="M21 12a9 9 0 1 1-6.219-8.56" />
	</Svg>
);
