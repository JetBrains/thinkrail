import { loadTasks, saveTasks } from "./storage.js";

const listEl = document.getElementById("task-list");
const emptyEl = document.getElementById("empty");
const formEl = document.getElementById("new-task");
const inputEl = document.getElementById("new-task-input");

let tasks = loadTasks();

function persist() {
	saveTasks(tasks);
	render();
}

function addTask(title) {
	const trimmed = title.trim();
	if (!trimmed) return;
	tasks = [...tasks, { id: crypto.randomUUID(), title: trimmed, done: false }];
	persist();
}

function toggleTask(id) {
	tasks = tasks.map((task) => (task.id === id ? { ...task, done: !task.done } : task));
	persist();
}

function deleteTask(id) {
	tasks = tasks.filter((task) => task.id !== id);
	persist();
}

function render() {
	listEl.replaceChildren();
	for (const task of tasks) {
		const item = document.createElement("li");
		item.className = task.done ? "task task--done" : "task";

		const checkbox = document.createElement("input");
		checkbox.type = "checkbox";
		checkbox.checked = task.done;
		checkbox.addEventListener("change", () => toggleTask(task.id));

		const title = document.createElement("span");
		title.className = "task__title";
		title.textContent = task.title;

		const remove = document.createElement("button");
		remove.type = "button";
		remove.className = "task__delete";
		remove.textContent = "✕";
		remove.setAttribute("aria-label", `Delete ${task.title}`);
		remove.addEventListener("click", () => deleteTask(task.id));

		item.append(checkbox, title, remove);
		listEl.append(item);
	}
	emptyEl.hidden = tasks.length > 0;
}

formEl.addEventListener("submit", (event) => {
	event.preventDefault();
	addTask(inputEl.value);
	inputEl.value = "";
	inputEl.focus();
});

render();
