import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export default function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder,
  searchPlaceholder = "بحث...",
  emptyMessage = "لا توجد نتائج",
  disabled = false,
  className,
  testId,
  selectedTitle = false,
  direction,
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  const resolvedDirection = direction
    || (typeof document !== "undefined" ? document.documentElement.dir : "")
    || "rtl";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          data-testid={testId}
          title={selectedTitle ? selected?.label || undefined : undefined}
          className={cn("h-8 w-full justify-between px-2 text-xs font-normal", className)}
        >
          <span className="truncate">{selected?.label || placeholder}</span>
          <ChevronsUpDown className="ms-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent dir={resolvedDirection} className="w-[--radix-popover-trigger-width] min-w-52 p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} data-testid={testId ? `${testId}-search` : undefined} />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.label} ${option.searchText || ""}`}
                  onSelect={() => {
                    onValueChange(option.value);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("h-4 w-4", value === option.value ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
