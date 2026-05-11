import { PageHeader, PageMain } from "@client/components/layout";
import type {
	ActiveEmployment,
	CreateActiveEmploymentInput,
	UpdateActiveEmploymentInput,
} from "@shared/types.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Briefcase,
	ChevronDown,
	ChevronUp,
	Pencil,
	Plus,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import * as api from "../api/active-employments";
import { queryKeys } from "../lib/queryKeys";

function formatPLN(amount: number): string {
	return new Intl.NumberFormat("pl-PL", {
		style: "currency",
		currency: "PLN",
		maximumFractionDigits: 0,
	}).format(amount);
}

interface EmploymentFormData {
	label: string;
	employer: string;
	startedAt: string;
	endedAt: string;
	timezone: string;
	coreHoursStart: string;
	coreHoursEnd: string;
	hourlyRatePLN: string;
	monthlyHours: string;
	weeklyHoursBudget: string;
	notes: string;
}

const EMPTY_FORM: EmploymentFormData = {
	label: "",
	employer: "",
	startedAt: new Date().toISOString().slice(0, 10),
	endedAt: "",
	timezone: "Europe/Warsaw",
	coreHoursStart: "",
	coreHoursEnd: "",
	hourlyRatePLN: "",
	monthlyHours: "160",
	weeklyHoursBudget: "",
	notes: "",
};

function employmentToForm(e: ActiveEmployment): EmploymentFormData {
	return {
		label: e.label,
		employer: e.employer,
		startedAt: e.startedAt.slice(0, 10),
		endedAt: e.endedAt ? e.endedAt.slice(0, 10) : "",
		timezone: e.timezone ?? "Europe/Warsaw",
		coreHoursStart: e.coreHoursStart ?? "",
		coreHoursEnd: e.coreHoursEnd ?? "",
		hourlyRatePLN: e.hourlyRatePLN != null ? String(e.hourlyRatePLN) : "",
		monthlyHours: e.monthlyHours != null ? String(e.monthlyHours) : "160",
		weeklyHoursBudget:
			e.weeklyHoursBudget != null ? String(e.weeklyHoursBudget) : "",
		notes: e.notes ?? "",
	};
}

function formToInput(
	form: EmploymentFormData,
): CreateActiveEmploymentInput | UpdateActiveEmploymentInput {
	return {
		label: form.label.trim(),
		employer: form.employer.trim(),
		startedAt: form.startedAt,
		endedAt: form.endedAt || null,
		timezone: form.timezone.trim() || null,
		coreHoursStart: form.coreHoursStart.trim() || null,
		coreHoursEnd: form.coreHoursEnd.trim() || null,
		hourlyRatePLN: form.hourlyRatePLN ? Number(form.hourlyRatePLN) : null,
		monthlyHours: form.monthlyHours ? Number(form.monthlyHours) : 160,
		weeklyHoursBudget: form.weeklyHoursBudget
			? Number(form.weeklyHoursBudget)
			: null,
		notes: form.notes.trim() || null,
	};
}

interface EmploymentFormProps {
	initial: EmploymentFormData;
	onSave: (data: EmploymentFormData) => void;
	onCancel: () => void;
	saving: boolean;
}

const EmploymentForm = ({
	initial,
	onSave,
	onCancel,
	saving,
}: EmploymentFormProps) => {
	const [form, setForm] = useState<EmploymentFormData>(initial);
	const set =
		(field: keyof EmploymentFormData) =>
		(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
			setForm((f) => ({ ...f, [field]: e.target.value }));

	return (
		<div className="space-y-3">
			<div className="grid grid-cols-2 gap-3">
				<div>
					<Label className="text-xs mb-1 block">Label (e.g. J1)</Label>
					<Input
						value={form.label}
						onChange={set("label")}
						placeholder="J1"
						className="h-8 text-sm"
					/>
				</div>
				<div>
					<Label className="text-xs mb-1 block">Employer</Label>
					<Input
						value={form.employer}
						onChange={set("employer")}
						placeholder="Acme Corp"
						className="h-8 text-sm"
					/>
				</div>
			</div>
			<div className="grid grid-cols-2 gap-3">
				<div>
					<Label className="text-xs mb-1 block">Started</Label>
					<Input
						type="date"
						value={form.startedAt}
						onChange={set("startedAt")}
						className="h-8 text-sm"
					/>
				</div>
				<div>
					<Label className="text-xs mb-1 block">
						Ended (leave blank = current)
					</Label>
					<Input
						type="date"
						value={form.endedAt}
						onChange={set("endedAt")}
						className="h-8 text-sm"
					/>
				</div>
			</div>
			<div className="grid grid-cols-2 gap-3">
				<div>
					<Label className="text-xs mb-1 block">Hourly rate (PLN/h)</Label>
					<Input
						type="number"
						value={form.hourlyRatePLN}
						onChange={set("hourlyRatePLN")}
						placeholder="120"
						className="h-8 text-sm"
					/>
				</div>
				<div>
					<Label className="text-xs mb-1 block">Hours / month</Label>
					<Input
						type="number"
						value={form.monthlyHours}
						onChange={set("monthlyHours")}
						placeholder="160"
						className="h-8 text-sm"
					/>
				</div>
			</div>
			{form.hourlyRatePLN && form.monthlyHours && (
				<p className="text-xs text-muted-foreground -mt-1">
					={" "}
					<span className="text-foreground font-medium">
						{formatPLN(Number(form.hourlyRatePLN) * Number(form.monthlyHours))}
					</span>{" "}
					gross/mo
				</p>
			)}
			<div className="grid grid-cols-2 gap-3">
				<div>
					<Label className="text-xs mb-1 block">Weekly hours budget</Label>
					<Input
						type="number"
						value={form.weeklyHoursBudget}
						onChange={set("weeklyHoursBudget")}
						placeholder="40"
						className="h-8 text-sm"
					/>
				</div>
				<div>
					<Label className="text-xs mb-1 block">Timezone</Label>
					<Input
						value={form.timezone}
						onChange={set("timezone")}
						placeholder="Europe/Warsaw"
						className="h-8 text-sm"
					/>
				</div>
			</div>
			<div className="grid grid-cols-2 gap-3">
				<div>
					<Label className="text-xs mb-1 block">Core hours start (HH:MM)</Label>
					<Input
						value={form.coreHoursStart}
						onChange={set("coreHoursStart")}
						placeholder="09:00"
						className="h-8 text-sm"
					/>
				</div>
				<div>
					<Label className="text-xs mb-1 block">Core hours end (HH:MM)</Label>
					<Input
						value={form.coreHoursEnd}
						onChange={set("coreHoursEnd")}
						placeholder="17:00"
						className="h-8 text-sm"
					/>
				</div>
			</div>
			<div>
				<Label className="text-xs mb-1 block">Notes</Label>
				<Input
					value={form.notes}
					onChange={set("notes")}
					placeholder="Optional notes"
					className="h-8 text-sm"
				/>
			</div>
			<div className="flex gap-2 justify-end pt-1">
				<Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
					Cancel
				</Button>
				<Button
					size="sm"
					onClick={() => onSave(form)}
					disabled={
						saving ||
						!form.label.trim() ||
						!form.employer.trim() ||
						!form.startedAt
					}
				>
					{saving ? "Saving…" : "Save"}
				</Button>
			</div>
		</div>
	);
};

interface EmploymentCardProps {
	employment: ActiveEmployment;
	onEdit: (e: ActiveEmployment) => void;
	onDelete: (id: string) => void;
	onEnd: (id: string) => void;
	deleting: boolean;
	ending: boolean;
}

const EmploymentCard = ({
	employment: e,
	onEdit,
	onDelete,
	onEnd,
	deleting,
	ending,
}: EmploymentCardProps) => {
	const isCurrent = !e.endedAt;
	return (
		<div className="border rounded-lg p-4 space-y-2 bg-card">
			<div className="flex items-start justify-between gap-2">
				<div>
					<div className="flex items-center gap-2">
						<span className="font-semibold text-sm">{e.label}</span>
						{isCurrent && (
							<Badge
								variant="secondary"
								className="text-[10px] px-1.5 py-0 bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
							>
								Current
							</Badge>
						)}
					</div>
					<p className="text-sm text-muted-foreground">{e.employer}</p>
				</div>
				<div className="flex items-center gap-1 shrink-0">
					<Button
						size="sm"
						variant="ghost"
						className="h-7 w-7 p-0"
						onClick={() => onEdit(e)}
					>
						<Pencil className="h-3 w-3" />
					</Button>
					{isCurrent && (
						<Button
							size="sm"
							variant="ghost"
							className="h-7 px-2 text-xs text-amber-400 hover:text-amber-300"
							onClick={() => onEnd(e.id)}
							disabled={ending}
						>
							End
						</Button>
					)}
					<Button
						size="sm"
						variant="ghost"
						className="h-7 w-7 p-0 text-destructive hover:text-destructive"
						onClick={() => onDelete(e.id)}
						disabled={deleting}
					>
						<Trash2 className="h-3 w-3" />
					</Button>
				</div>
			</div>
			<div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
				<span>
					{e.startedAt.slice(0, 10)}
					{e.endedAt ? ` → ${e.endedAt.slice(0, 10)}` : " → present"}
				</span>
				{e.hourlyRatePLN != null && (
					<span className="text-foreground font-medium">
						{formatPLN(e.hourlyRatePLN)}/h
						{e.monthlyHours != null && (
							<>
								{" "}
								× {e.monthlyHours}h ={" "}
								{formatPLN(e.hourlyRatePLN * e.monthlyHours)}/mo
							</>
						)}
					</span>
				)}
				{e.hourlyRatePLN == null && e.monthlyGrossPLN != null && (
					<span className="text-foreground font-medium">
						{formatPLN(e.monthlyGrossPLN)}/mo
					</span>
				)}
				{e.weeklyHoursBudget != null && <span>{e.weeklyHoursBudget}h/wk</span>}
				{e.coreHoursStart && e.coreHoursEnd && (
					<span>
						Core: {e.coreHoursStart}–{e.coreHoursEnd}{" "}
						{e.timezone ? `(${e.timezone})` : ""}
					</span>
				)}
			</div>
			{e.notes && (
				<p className="text-xs text-muted-foreground italic">{e.notes}</p>
			)}
		</div>
	);
};

export const MyEmploymentPage = () => {
	const qc = useQueryClient();
	const [showForm, setShowForm] = useState(false);
	const [editing, setEditing] = useState<ActiveEmployment | null>(null);
	const [showPast, setShowPast] = useState(false);

	const { data, isLoading } = useQuery({
		queryKey: queryKeys.activeEmployments.list(),
		queryFn: api.listActiveEmployments,
	});

	const invalidate = () =>
		qc.invalidateQueries({ queryKey: queryKeys.activeEmployments.all });

	const createMutation = useMutation({
		mutationFn: (form: EmploymentFormData) =>
			api.createActiveEmployment(
				formToInput(form) as CreateActiveEmploymentInput,
			),
		onSuccess: () => {
			setShowForm(false);
			invalidate();
		},
	});

	const updateMutation = useMutation({
		mutationFn: ({ id, form }: { id: string; form: EmploymentFormData }) =>
			api.updateActiveEmployment(id, formToInput(form)),
		onSuccess: () => {
			setEditing(null);
			invalidate();
		},
	});

	const deleteMutation = useMutation({
		mutationFn: api.deleteActiveEmployment,
		onSuccess: () => invalidate(),
	});

	const endMutation = useMutation({
		mutationFn: (id: string) =>
			api.updateActiveEmployment(id, {
				endedAt: new Date().toISOString().slice(0, 10),
			}),
		onSuccess: () => invalidate(),
	});

	const employments = data?.employments ?? [];
	const stack = data?.stack;
	const current = employments.filter((e) => !e.endedAt);
	const past = employments.filter((e) => !!e.endedAt);

	return (
		<>
			<PageHeader
				icon={Briefcase}
				title="My Employment"
				subtitle="Track active jobs and monitor your total compensation stack."
			/>
			<PageMain>
				<div className="space-y-6">
					{/* Salary stack */}
					{stack && stack.currentCount > 0 && (
						<div className="rounded-lg border bg-card p-5 grid grid-cols-3 gap-4 text-center">
							<div>
								<p className="text-2xl font-bold tabular-nums">
									{formatPLN(stack.monthlyPLN)}
								</p>
								<p className="text-xs text-muted-foreground mt-0.5">
									Monthly gross
								</p>
							</div>
							<div>
								<p className="text-2xl font-bold tabular-nums">
									{formatPLN(stack.annualPLN)}
								</p>
								<p className="text-xs text-muted-foreground mt-0.5">
									Annual gross
								</p>
							</div>
							<div>
								<p className="text-2xl font-bold tabular-nums">
									{stack.currentCount}
								</p>
								<p className="text-xs text-muted-foreground mt-0.5">
									Active job{stack.currentCount !== 1 ? "s" : ""}
								</p>
							</div>
						</div>
					)}

					{/* Add form */}
					{showForm && (
						<div className="rounded-lg border bg-card p-4">
							<h3 className="text-sm font-medium mb-3">New Employment</h3>
							<EmploymentForm
								initial={EMPTY_FORM}
								onSave={(form) => createMutation.mutate(form)}
								onCancel={() => setShowForm(false)}
								saving={createMutation.isPending}
							/>
						</div>
					)}

					{/* Current */}
					<div>
						<div className="flex items-center justify-between mb-3">
							<h2 className="text-sm font-semibold">
								Current ({current.length})
							</h2>
							{!showForm && (
								<Button
									size="sm"
									variant="outline"
									className="h-7 text-xs gap-1"
									onClick={() => setShowForm(true)}
								>
									<Plus className="h-3 w-3" /> Add employment
								</Button>
							)}
						</div>
						{isLoading && (
							<p className="text-sm text-muted-foreground">Loading…</p>
						)}
						{!isLoading && current.length === 0 && (
							<p className="text-sm text-muted-foreground">
								No current employments. Add one to start tracking your salary
								stack.
							</p>
						)}
						<div className="space-y-3">
							{current.map((e) => (
								<EmploymentCard
									key={e.id}
									employment={e}
									onEdit={setEditing}
									onDelete={(id) => deleteMutation.mutate(id)}
									onEnd={(id) => endMutation.mutate(id)}
									deleting={deleteMutation.isPending}
									ending={endMutation.isPending}
								/>
							))}
						</div>
					</div>

					{/* Past */}
					{past.length > 0 && (
						<div>
							<button
								type="button"
								className="flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground mb-3"
								onClick={() => setShowPast((v) => !v)}
							>
								{showPast ? (
									<ChevronUp className="h-4 w-4" />
								) : (
									<ChevronDown className="h-4 w-4" />
								)}
								Past ({past.length})
							</button>
							{showPast && (
								<div className="space-y-3">
									{past.map((e) => (
										<EmploymentCard
											key={e.id}
											employment={e}
											onEdit={setEditing}
											onDelete={(id) => deleteMutation.mutate(id)}
											onEnd={(id) => endMutation.mutate(id)}
											deleting={deleteMutation.isPending}
											ending={endMutation.isPending}
										/>
									))}
								</div>
							)}
						</div>
					)}
				</div>
			</PageMain>

			{/* Edit dialog */}
			<Dialog
				open={!!editing}
				onOpenChange={(open) => !open && setEditing(null)}
			>
				<DialogContent className="max-w-lg">
					<DialogHeader>
						<DialogTitle>Edit Employment</DialogTitle>
					</DialogHeader>
					{editing && (
						<EmploymentForm
							initial={employmentToForm(editing)}
							onSave={(form) => updateMutation.mutate({ id: editing.id, form })}
							onCancel={() => setEditing(null)}
							saving={updateMutation.isPending}
						/>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
};
