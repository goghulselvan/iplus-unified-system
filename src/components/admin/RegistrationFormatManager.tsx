import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { GripVertical, RotateCcw, Eye, Info } from "lucide-react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import {
  useRegistrationFormatConfig,
  useUpdateRegistrationFormat,
  FORMAT_COMPONENTS,
  type FormatComponentInfo,
} from "@/hooks/useRegistrationFormatConfig";

interface RegistrationFormatManagerProps {
  projectId: string;
}

// 12-digit sample: sub(1)-state(2)-district(2)-school(2)-class(2)-roll(3)
const SAMPLE_REG = "2-33-38-01-05-001";

function buildPreview(componentOrder: FormatComponentInfo[], separator: string): {
  stored: string;
  displayed: string;
} {
  const parts = SAMPLE_REG.split("-");
  const map: Record<string, string> = {
    subject: parts[0],
    state: parts[1],
    district: parts[2],
    school: parts[3],
    class: parts[4],
    student: parts[5],
  };

  const storedParts = componentOrder.map((c) => map[c.key]);
  const stored = storedParts.join(separator);

  // 4-segment display: subject – schoolcode – class – roll
  // schoolcode = state+district+school concatenated
  const schoolCode = map.state + map.district + map.school;
  const displayed = `${map.subject}${separator}${schoolCode}${separator}${map.class}${separator}${map.student}`;

  return { stored, displayed };
}

export const RegistrationFormatManager: React.FC<RegistrationFormatManagerProps> = ({
  projectId,
}) => {
  const { data: currentFormat, isLoading } = useRegistrationFormatConfig(projectId);
  const updateFormat = useUpdateRegistrationFormat();

  const [formatName, setFormatName] = useState(currentFormat?.format_name || "Default Format");
  const [separator, setSeparator] = useState(currentFormat?.separator || "-");
  const [componentOrder, setComponentOrder] = useState<FormatComponentInfo[]>(
    currentFormat?.component_order?.map(key =>
      FORMAT_COMPONENTS.find(comp => comp.key === key)!
    ).filter(Boolean) || [...FORMAT_COMPONENTS]
  );

  React.useEffect(() => {
    if (currentFormat) {
      setFormatName(currentFormat.format_name);
      setSeparator(currentFormat.separator);
      setComponentOrder(
        currentFormat.component_order?.map(key =>
          FORMAT_COMPONENTS.find(comp => comp.key === key)!
        ).filter(Boolean) || [...FORMAT_COMPONENTS]
      );
    }
  }, [currentFormat]);

  const handleDragEnd = (result: any) => {
    if (!result.destination) return;
    const items = Array.from(componentOrder);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    setComponentOrder(items);
  };

  const resetToDefault = () => {
    setComponentOrder([...FORMAT_COMPONENTS]);
    setSeparator("-");
    setFormatName("Default Format");
  };

  const handleSave = () => {
    updateFormat.mutate({
      projectId,
      formatName,
      componentOrder: componentOrder.map(comp => comp.key),
      separator,
    });
  };

  const { stored: storedPreview, displayed: displayedPreview } = React.useMemo(
    () => buildPreview(componentOrder, separator),
    [componentOrder, separator]
  );

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Registration Number Format</CardTitle>
          <CardDescription>Loading configuration…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Registration Number Format</CardTitle>
        <CardDescription>
          Configure how registration numbers are stored (6 segments) and displayed to schools and students (4 segments).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* Concept explainer */}
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="space-y-1">
            <p>
              <strong>Stored (6 segments):</strong>{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">Subject – State – District – School – Class – Roll</code>
              {" "}→ 12 numeric digits
            </p>
            <p>
              <strong>Displayed to student (4 segments):</strong>{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">Subject – SCHOOL CODE – Class – Roll</code>
            </p>
            <p className="text-muted-foreground text-xs">
              SCHOOL CODE = State(2) + District(2) + School(2) combined into one 6-digit code.
              District and School are always 2 digits (max 99 each). Students write this on their answer sheet.
            </p>
          </AlertDescription>
        </Alert>

        {/* Subject code reference */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
          {[
            { code: 1, name: "EPO" },
            { code: 2, name: "MPO" },
            { code: 3, name: "SPO" },
            { code: 4, name: "GKSSPO" },
            { code: 5, name: "LRPO" },
            { code: 9, name: "KidsPO" },
          ].map(({ code, name }) => (
            <div key={code} className="p-2 bg-muted/60 rounded-lg border">
              <div className="text-lg font-bold font-mono text-foreground">{code}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{name}</div>
            </div>
          ))}
        </div>

        {/* Format name + separator */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="formatName">Format Name</Label>
            <Input
              id="formatName"
              value={formatName}
              onChange={(e) => setFormatName(e.target.value)}
              placeholder="e.g. iPlus 2026 Standard"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="separator">Separator</Label>
            <Input
              id="separator"
              value={separator}
              onChange={(e) => setSeparator(e.target.value)}
              placeholder="e.g. -"
              maxLength={3}
            />
          </div>
        </div>

        {/* Component order (drag-and-drop) */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-base font-medium">Segment Order (stored format)</Label>
            <Button variant="outline" size="sm" onClick={resetToDefault}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset to Default
            </Button>
          </div>

          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="components">
              {(provided) => (
                <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-2">
                  {componentOrder.map((component, index) => (
                    <Draggable key={component.key} draggableId={component.key} index={index}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          className={`flex items-center p-3 bg-card border rounded-lg transition-colors ${
                            snapshot.isDragging ? "shadow-md bg-accent" : ""
                          }`}
                        >
                          <div
                            {...provided.dragHandleProps}
                            className="mr-3 text-muted-foreground hover:text-foreground cursor-grab"
                          >
                            <GripVertical className="h-4 w-4" />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary">{index + 1}</Badge>
                              <span className="font-medium">{component.label}</span>
                              <Badge variant="outline">{component.example}</Badge>
                              {(component.key === "district" || component.key === "school") && (
                                <Badge variant="outline" className="text-xs text-amber-600 border-amber-200 bg-amber-50">
                                  2-digit
                                </Badge>
                              )}
                              {(component.key === "state" || component.key === "district" || component.key === "school") && (
                                <Badge variant="outline" className="text-xs text-indigo-600 border-indigo-200 bg-indigo-50">
                                  → SCHOOL CODE
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">{component.description}</p>
                          </div>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        </div>

        {/* Live Preview */}
        <div className="space-y-3">
          <Label className="flex items-center gap-1.5"><Eye className="h-4 w-4" /> Live Preview</Label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3 bg-muted rounded-lg border">
              <p className="text-xs font-medium text-muted-foreground mb-1">Stored in database (6 segments)</p>
              <div className="font-mono text-base font-semibold">{storedPreview}</div>
              <p className="text-xs text-muted-foreground mt-1">12 numeric digits</p>
            </div>
            <div className="p-3 bg-indigo-50 rounded-lg border border-indigo-100">
              <p className="text-xs font-medium text-indigo-600 mb-1">Displayed to student (4 segments)</p>
              <div className="font-mono text-base font-semibold text-indigo-700">{displayedPreview}</div>
              <p className="text-xs text-indigo-500 mt-1">Subject – School Code – Class – Roll</p>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={updateFormat.isPending}>
            {updateFormat.isPending ? "Saving…" : "Save Format"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
