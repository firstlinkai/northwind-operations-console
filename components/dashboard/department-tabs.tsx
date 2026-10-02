"use client";

/**
 * Departmental tab shell.
 *
 * Composition only — every figure lives in the tab bodies. Keeping this file
 * thin means the three departments can be reordered, lazy-loaded or reused on
 * another page without touching any of their internals.
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CallingTab } from "@/components/dashboard/calling-tab";
import { HrTab } from "@/components/dashboard/hr-tab";
import { OperationsTab } from "@/components/dashboard/operations-tab";
import type { CallingMetrics, HrMetrics, OperationsMetrics } from "@/lib/types";

export function DepartmentTabs({
  hr,
  operations,
  calling,
}: {
  hr: HrMetrics;
  operations: OperationsMetrics;
  calling: CallingMetrics;
}) {
  return (
    <Tabs defaultValue="hr" className="gap-4">
      <TabsList variant="line" aria-label="Departmental metrics">
        <TabsTrigger value="hr">HR</TabsTrigger>
        <TabsTrigger value="operations">Operations</TabsTrigger>
        <TabsTrigger value="calling">Onboarding &amp; Calling</TabsTrigger>
      </TabsList>

      <TabsContent value="hr">
        <HrTab data={hr} />
      </TabsContent>
      <TabsContent value="operations">
        <OperationsTab data={operations} />
      </TabsContent>
      <TabsContent value="calling">
        <CallingTab data={calling} />
      </TabsContent>
    </Tabs>
  );
}
