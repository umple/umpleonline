import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, RefreshCw } from "lucide-react";
import { api } from "@/api/client";
import type { StatusResponse } from "@/api/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const REFRESH_INTERVAL_MS = 30_000;

type HealthRecord = {
  group: string;
  name: string;
  data: Record<string, unknown>;
};

export function StatusPage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadStatus = useCallback(async (signal?: AbortSignal) => {
    setError(null);
    setRefreshing(true);
    try {
      const next = await api.status(signal);
      setStatus(next);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to load status");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadStatus(controller.signal);
    const interval = window.setInterval(() => {
      void loadStatus();
    }, REFRESH_INTERVAL_MS);

    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [loadStatus]);

  return (
    <main className="h-screen overflow-y-auto bg-surface-1 text-ink">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-3 rounded-lg border border-border bg-surface-0 px-4 py-4 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <img src="/umple-logo.svg" alt="" className="mt-0.5 h-9 w-auto shrink-0" />
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold tracking-tight">UmpleOnline Status</h1>
                {status ? <StatusBadge value={status.status} /> : null}
              </div>
              <p className="text-sm text-ink-muted">
                Developer monitoring for the backend, compiler, collaboration, LSP, and execution services.
              </p>
              {status ? (
                <p className="text-xs text-ink-faint">
                  Last refresh {formatDate(status.generatedAt)}. Auto-refreshes every 30 seconds.
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/">Back to editor</Link>
            </Button>
            <Button onClick={() => void loadStatus()} disabled={refreshing} size="sm">
              <RefreshCw data-icon="inline-start" />
              {refreshing ? "Refreshing" : "Refresh"}
            </Button>
          </div>
        </header>

        {error ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Status unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {loading && !status ? <StatusSkeleton /> : null}
        {status ? <StatusContent status={status} /> : null}
      </div>
    </main>
  );
}

function StatusContent({ status }: { status: StatusResponse }) {
  const release = status.release ?? {};
  const legacy = status.legacy ?? {};
  const legacyDocker = asRecord(legacy.docker);
  const runtimeToolRecords = withRuntimeToolPurposes(asRecordArray(legacy.software));
  const releaseLabel = formatValue(release.releaseTag) || shortCommit(status.build?.sourceCommit) || "unknown";
  const releaseDetail = shortCommit(release.sourceCommit) || shortCommit(status.build?.sourceCommit) || formatValue(status.build?.sourceRefName);
  const compilerState = formatValue(status.umplesync?.alive) === "true" ? "Running" : "Not running";
  const healthRecords = buildHealthRecords(status);
  const summary = status.summary;


  return (
    <div className="flex flex-col gap-4" data-testid="status-dashboard">
      <OverviewStrip
        items={[
          { label: "Backend uptime", value: formatDuration(status.uptimeSeconds), detail: "Since this process started" },
          { label: "Release", value: releaseLabel, detail: releaseDetail || "No release metadata" },
          { label: "Compiler", value: compilerState, detail: `Port ${formatValue(status.umplesync?.port) || "unknown"}` },
          { label: "Health rows", value: String(healthRecords.length), detail: "Services, checks, dependencies" },
        ]}
      />

      <StatusSection title="Usage & compiler version"
        description="Visits and browser tab sessions since tracking began in this deployment; compiler totals include monitoring commands"
        testId="status-usage">
        <KeyValueTable data={{
          editorVisits: summary?.visits ?? status.counters?.visitsStartedHistorical ?? "Unavailable",
          sessionsStartedHistorically: summary?.sessions ?? status.counters?.sessionsStartedHistorical ?? "Unavailable",
          sessionsStartedSinceBackendStart: status.counters?.sessionsStartedSinceStart ?? "Unavailable",
          compilerVersion: summary?.compiler.version ?? "Unavailable",
          commandsSinceCompilerStart: summary?.compiler.commandsSinceStart ?? "Unavailable",
          commandsRunHistorically: summary?.compiler.commandsHistorical ?? "Unavailable",
        }} />
      </StatusSection>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(22rem,0.65fr)]">
        <StatusSection
          title="Service health"
          description="Service health, backend-container software versions and configured filesystem dependencies"
          testId="status-service-health"
        >
          <HealthTable records={healthRecords} />
        </StatusSection>

        <StatusSection
          title="Release & runtime"
          description="Build provenance, deployment metadata, backend process, and configured service targets"
          testId="status-release-runtime"
        >
          <SectionBlock title="Build">
            <KeyValueTable data={status.build} compact />
          </SectionBlock>
          <SectionBlock title="Release">
            <KeyValueTable data={status.release} compact />
          </SectionBlock>
          <SectionBlock title="Process">
            <KeyValueTable data={status.process} compact />
          </SectionBlock>
          <SectionBlock title="Config">
            <KeyValueTable data={status.config} compact />
          </SectionBlock>
        </StatusSection>
      </div>

      <StatusSection
        title="Umplesync compiler"
        description="Compiler process, command counts, load, queue and timing details from umplesync -log; snapshots are shared for 30 seconds"
        action={<StatusBadge value={formatValue(status.umplesync?.status)} />}
        testId="status-umplesync"
      >
        <KeyValueTable data={withoutKeys(status.umplesync, ["log"])} />
        <Separator className="my-4" />
        <pre className="max-h-[28rem] overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed text-foreground">
          {formatValue(status.umplesync?.log) || "No log output returned."}
        </pre>
      </StatusSection>

      <div className="grid gap-4 lg:grid-cols-2">
        <StatusSection title="Collaboration server"
          description="Active users are connected clients. A session is a room lifetime; a collaborated session has had at least two clients."
          action={<StatusBadge value={formatValue(status.services?.collaboration?.status)} />}
          testId="status-collaboration">
          <KeyValueTable data={status.services?.collaboration} />
        </StatusSection>
        <StatusSection title="LSP server"
          description="Language server proxy uptime, active sessions, rejected connections and process limits"
          action={<StatusBadge value={formatValue(status.services?.lsp?.status)} />}
          testId="status-lsp">
          <KeyValueTable data={status.services?.lsp} />
        </StatusSection>
        <StatusSection title="Execution server"
          description="Code execution requests, concurrency limits, runner image, timeout and Docker availability"
          action={<StatusBadge value={formatValue(status.services?.codeExecution?.status)} />}
          testId="status-execution">
          <KeyValueTable data={withoutKeys(status.services?.codeExecution, ["docker"])} />
        </StatusSection>
      </div>

      <StatusSection
        title="Diagnostics"
        description="Counters and operational probes for runtime tools, compiler listener, containers, and execution settings"
        testId="status-diagnostics"
      >
        <div className="grid gap-4 xl:grid-cols-2">
          <SectionBlock title="Counters">
            <KeyValueTable data={status.counters} compact />
          </SectionBlock>
          <SectionBlock title="Visit counter">
            <KeyValueTable data={asRecord(legacy.visits)} compact />
          </SectionBlock>
          <SectionBlock title="Runtime tools">
            <RecordsTable records={runtimeToolRecords} primary="name" />
          </SectionBlock>
          <SectionBlock title="Compiler listener">
            <KeyValueTable data={asRecord(legacy.listener)} compact />
          </SectionBlock>
          <SectionBlock title="Containers & resource usage" className="xl:col-span-2">
            <KeyValueTable data={withoutKeys(legacyDocker, ["stats", "containers"])} compact />
            <Separator className="my-3" />
            <RecordsTable records={asRecordArray(legacyDocker.containers)} primary="name" />
            <Separator className="my-3" />
            <RecordsTable records={asRecordArray(legacyDocker.stats)} primary="Name" />
          </SectionBlock>
          <SectionBlock title="Code execution settings" className="xl:col-span-2">
            <KeyValueTable data={asRecord(legacy.execution)} compact />
          </SectionBlock>
        </div>
      </StatusSection>
    </div>
  );
}

function OverviewStrip({
  items,
}: {
  items: Array<{ label: string; value: string; detail: string }>;
}) {
  return (
    <section className="grid overflow-hidden rounded-lg border border-border bg-surface-0 shadow-sm sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item, index) => (
        <div
          key={item.label}
          className={cn(
            "min-w-0 px-4 py-3",
            index > 0 && "border-t border-border sm:border-l sm:border-t-0",
            index === 2 && "sm:border-l-0 xl:border-l",
          )}
        >
          <p className="text-xs font-medium uppercase text-ink-faint">{item.label}</p>
          <p className="mt-1 truncate text-xl font-semibold tracking-tight">{item.value}</p>
          <p className="mt-0.5 truncate text-xs text-ink-muted">{item.detail}</p>
        </div>
      ))}
    </section>
  );
}

function StatusSection({
  title,
  description,
  action,
  children,
  testId,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <Card className="min-w-0 gap-4 rounded-lg py-4" data-testid={testId}>
      <CardHeader className="gap-1 px-4 sm:px-5">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent className="px-4 sm:px-5">{children}</CardContent>
    </Card>
  );
}

function SectionBlock({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("min-w-0", className)}>
      <h2 className="mb-2 text-xs font-semibold uppercase text-ink-faint">{title}</h2>
      <div className="overflow-hidden rounded-md border border-border bg-surface-0/40">{children}</div>
    </section>
  );
}

function buildHealthRecords(status: StatusResponse): HealthRecord[] {
  const services = Object.entries(status.services ?? {}).map(([name, data]) => ({
    group: "Service",
    name: serviceTitle(name),
    data: Object.fromEntries(
      ["status", "pid", "port", "url", "uptimeSeconds", "nodeVersion", "error"]
        .filter((key) => data[key] !== undefined)
        .map((key) => [key, data[key]]),
    ),
  }));
  const checks = Object.entries(status.checks ?? {}).map(([name, data]) => ({
    group: "Check",
    name: labelize(name),
    data,
  }));
  const dependencies = (status.dependencies ?? []).map((data) => ({
    group: "Dependency",
    name: formatValue(data.name) || "Dependency",
    data,
  }));

  return [...services, ...checks, ...dependencies];
}

function withRuntimeToolPurposes(records: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return records.map((record) => ({
    name: record.name,
    purpose: runtimeToolPurpose(formatValue(record.name)),
    ...withoutKeys(record, ["name"]),
  }));
}

function runtimeToolPurpose(name: string): string {
  switch (name) {
    case "java":
      return "Runs umplesync.jar, the Umple compiler service";
    case "dot":
      return "Graphviz renderer for diagram layout output";
    case "python":
      return "Python runtime configured in the backend container";
    case "docker":
      return "Container runtime used for services and isolated code execution";
    default:
      return "Runtime command reported by the status endpoint";
  }
}

function HealthTable({ records }: { records: HealthRecord[] }) {
  if (records.length === 0) {
    return <p className="text-sm text-muted-foreground">No health records reported.</p>;
  }

  return (
    <div className="overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-28">Group</TableHead>
            <TableHead className="w-44">Name</TableHead>
            <TableHead className="w-28">Status</TableHead>
            <TableHead>Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record, index) => (
            <TableRow key={`${record.group}-${record.name}-${index}`}>
              <TableCell className="align-top text-xs text-ink-muted">{record.group}</TableCell>
              <TableCell className="align-top font-medium">{record.name}</TableCell>
              <TableCell className="align-top">
                <StatusBadge value={formatValue(record.data.status) || "unknown"} />
              </TableCell>
              <TableCell className="max-w-[42rem] whitespace-normal break-words align-top font-mono text-xs">
                <CompactRecord data={withoutKeys(record.data, ["name", "status"])} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function CompactRecord({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, value]) => formatValue(value) !== "");
  if (entries.length === 0) return <span className="text-ink-faint">No detail</span>;

  return (
    <dl className="grid gap-1">
      {entries.map(([key, value]) => (
        <div key={key} className="grid gap-1 md:grid-cols-[9rem_minmax(0,1fr)]">
          <dt className="font-sans text-xs font-medium text-ink-muted">{labelize(key)}</dt>
          <dd className="min-w-0 break-words">
            <FormattedValue value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function KeyValueTable({
  data,
  compact = false,
}: {
  data: Record<string, unknown> | undefined;
  compact?: boolean;
}) {
  const entries = Object.entries(data ?? {});
  if (entries.length === 0) {
    return <p className="px-3 py-2 text-sm text-muted-foreground">No data reported.</p>;
  }

  return (
    <Table>
      <TableBody>
        {entries.map(([key, value]) => (
          <TableRow key={key}>
            <TableCell className={cn("align-top font-medium text-muted-foreground", compact ? "w-2/5 whitespace-normal break-words py-2" : "w-2/5 whitespace-normal break-words sm:w-48")}>
              {labelize(key)}
            </TableCell>
            <TableCell className={cn("max-w-[44rem] whitespace-normal break-words font-mono text-xs", compact && "py-2")}>
              <FormattedValue value={value} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function RecordsTable({
  records,
  primary,
}: {
  records: Array<Record<string, unknown>>;
  primary: string;
}) {
  if (records.length === 0) {
    return <p className="px-3 py-2 text-sm text-muted-foreground">No records reported.</p>;
  }

  const keys = Array.from(new Set(records.flatMap((record) => Object.keys(record))));
  const sortedKeys = [primary, ...keys.filter((key) => key !== primary)];

  return (
    <div className="overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {sortedKeys.map((key) => (
              <TableHead key={key}>{labelize(key)}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record, index) => (
            <TableRow key={`${formatValue(record[primary])}-${index}`}>
              {sortedKeys.map((key) => (
                <TableCell key={key} className="max-w-[28rem] whitespace-normal break-words font-mono text-xs">
                  <FormattedValue value={record[key]} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function FormattedValue({ value }: { value: unknown }) {
  if (isStatusValue(value)) {
    return <StatusBadge value={value} />;
  }
  if (typeof value === "boolean") {
    return <Badge variant="outline">{value ? "true" : "false"}</Badge>;
  }
  if (value && typeof value === "object") {
    return <pre className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{JSON.stringify(value, null, 2)}</pre>;
  }
  return <>{formatValue(value)}</>;
}

function StatusBadge({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const className = cn(
    "border font-semibold",
    (normalized === "ok" || normalized === "running") &&
      "border-status-success/30 bg-status-success/10 text-status-success",
    (normalized === "degraded" || normalized === "unparsed" || normalized === "not_tracked") &&
      "border-status-warning/30 bg-status-warning/10 text-status-warning",
    (normalized === "unreachable" || normalized === "unavailable") &&
      "border-status-error/30 bg-status-error/10 text-status-error",
  );

  return (
    <Badge variant="outline" className={className}>
      {value || "unknown"}
    </Badge>
  );
}

function StatusSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <Card key={index}>
          <CardHeader>
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function isStatusValue(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return ["ok", "degraded", "unreachable", "unavailable", "not_tracked", "running", "unparsed"].includes(value.toLowerCase());
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function shortCommit(value: unknown): string {
  const commit = formatValue(value);
  if (!commit || commit === "unknown") return "";
  return commit.length > 12 ? commit.slice(0, 12) : commit;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds)) return "";
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function labelize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (match) => match.toUpperCase());
}

function serviceTitle(value: string): string {
  if (value === "codeExecution") return "Code Execution";
  if (value === "lsp") return "LSP";
  return labelize(value);
}

function withoutKeys(data: Record<string, unknown> | undefined, keys: string[]) {
  return Object.fromEntries(Object.entries(data ?? {}).filter(([key]) => !keys.includes(key)));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => (
    item !== null && typeof item === "object" && !Array.isArray(item)
  ));
}
