// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import type { Label } from "~/types";
import { queryKeys } from "./keys";

export function useLabels(mailboxId: string | undefined) {
	return useQuery<Label[]>({
		queryKey: mailboxId
			? queryKeys.labels.list(mailboxId)
			: ["labels", "_disabled"],
		queryFn: () => api.listLabels(mailboxId!) as Promise<Label[]>,
		enabled: !!mailboxId,
	});
}

function useInvalidateLabels() {
	const qc = useQueryClient();
	return (mailboxId: string) => {
		qc.invalidateQueries({ queryKey: queryKeys.labels.list(mailboxId) });
		qc.invalidateQueries({ queryKey: ["emails", mailboxId] });
	};
}

export function useCreateLabel() {
	const invalidate = useInvalidateLabels();
	return useMutation({
		mutationFn: ({
			mailboxId,
			name,
			color,
		}: { mailboxId: string; name: string; color?: string }) =>
			api.createLabel(mailboxId, name, color),
		onSuccess: (_data, { mailboxId }) => invalidate(mailboxId),
	});
}

export function useApplyLabel() {
	const invalidate = useInvalidateLabels();
	return useMutation({
		mutationFn: ({
			mailboxId,
			emailId,
			labelId,
		}: { mailboxId: string; emailId: string; labelId: string }) =>
			api.applyLabel(mailboxId, emailId, labelId),
		onSuccess: (_data, { mailboxId }) => invalidate(mailboxId),
	});
}

export function useRemoveLabel() {
	const invalidate = useInvalidateLabels();
	return useMutation({
		mutationFn: ({
			mailboxId,
			emailId,
			labelId,
		}: { mailboxId: string; emailId: string; labelId: string }) =>
			api.removeLabel(mailboxId, emailId, labelId),
		onSuccess: (_data, { mailboxId }) => invalidate(mailboxId),
	});
}
