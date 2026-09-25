import * as remixicon from "@ext-runtime/remixicon";
import {
	EXT_RUNTIME_GLOBAL,
	type ExtRuntimeModule,
	type ExtViewExport,
	type ExtViewUiExport,
} from "@thinkrail/contracts";
import * as React from "react";
import * as jsxDevRuntime from "react/jsx-dev-runtime";
import * as jsxRuntime from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import { Button } from "../components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "../components/ui/command";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "../components/ui/context-menu";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "../components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { Textarea } from "../components/ui/textarea";
import { IconTooltip, Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { cn } from "../lib";
import { startChat } from "./askAgent";
import { openSurface, useAction, useChannel } from "./hooks";
import { useHostContext } from "./hostContext";

export const viewUi = {
	Button,
	Textarea,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
	IconTooltip,
	Popover,
	PopoverAnchor,
	PopoverContent,
	PopoverTrigger,
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} satisfies Record<ExtViewUiExport, unknown>;

export const viewModule = {
	useChannel,
	useAction,
	useHostContext,
	openSurface: (name: string, surfaceId: string, params?: Record<string, string>) => {
		openSurface(name, surfaceId, params);
	},
	startChat,
	ui: viewUi,
	cn,
	remixicon,
} satisfies Record<ExtViewExport, unknown>;

export const runtimeModules = {
	react: React,
	"react/jsx-runtime": jsxRuntime,
	"react/jsx-dev-runtime": jsxDevRuntime,
	"react-dom": ReactDOM,
	"@thinkrail/ext/view": viewModule,
} satisfies Record<ExtRuntimeModule, object>;

export const installRuntime = () => {
	if (!Reflect.has(globalThis, EXT_RUNTIME_GLOBAL))
		Reflect.set(globalThis, EXT_RUNTIME_GLOBAL, Object.freeze({ ...runtimeModules }));
};
