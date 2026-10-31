import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

export function WorkspaceFolderPicker(props: {
  readonly roots: ReadonlyArray<string>;
  readonly value: string;
  readonly onChange: (root: string) => void;
}) {
  if (props.roots.length < 2) return null;
  return (
    <div className="min-w-0 px-3 py-2">
      <Select
        value={props.value}
        onValueChange={(root) => {
          if (root) props.onChange(root);
        }}
      >
        <SelectTrigger size="sm" aria-label="Project folder">
          <SelectValue>
            {props.value.split(/[\\/]/).filter(Boolean).at(-1) ?? props.value}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {props.roots.map((root, index) => (
            <SelectItem key={root} value={root}>
              {root}
              {index === 0 ? " (primary)" : ""}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}
