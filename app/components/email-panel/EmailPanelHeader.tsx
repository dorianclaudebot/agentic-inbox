// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Label } from "~/types";

interface EmailPanelHeaderProps {
	subject: string;
	messageCount: number;
	showThreadCount: boolean;
	labels?: Label[];
}

export default function EmailPanelHeader({
	subject,
	messageCount,
	showThreadCount,
	labels = [],
}: EmailPanelHeaderProps) {
	return (
		<div className="px-4 py-3 border-b border-kumo-line shrink-0 md:px-6">
			<h2 className="text-base font-semibold text-kumo-default">{subject}</h2>
			{showThreadCount && (
				<span className="text-xs text-kumo-subtle mt-0.5 block">
					{messageCount} messages in this thread
				</span>
			)}
			{labels.length > 0 && (
				<div className="flex flex-wrap gap-1.5 mt-2">
					{labels.map((label) => (
						<span
							key={label.id}
							className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-kumo-default bg-kumo-fill"
						>
							<span className="h-2 w-2 rounded-full" style={{ backgroundColor: label.color }} />
							{label.name}
						</span>
					))}
				</div>
			)}
		</div>
	);
}
