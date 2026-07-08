import { readTextFile } from "@std/fs/unstable-read-text-file";
import { writeTextFile } from "@std/fs/unstable-write-text-file";
import { fromFileUrl } from "@std/path";

const denoJson = await readTextFile(
	fromFileUrl(import.meta.resolve("../deno.json")),
);
const chartYaml = await readTextFile(
	fromFileUrl(import.meta.resolve("../helm/shuriken/Chart.yaml")),
);

const denoJsonVersion = JSON.parse(denoJson).version;
const chartYamlVersion = chartYaml.match(/version:\s*(\d+\.\d+\.\d+)/)?.[1];

const bumpType = prompt(
	"Bump type (major = 1, minor = 2, patch = 3, custom = 4): ",
);

const [major, minor, patch] = denoJsonVersion.split(".").map(Number);
let newVersion: string;

switch (bumpType) {
	case "1":
		newVersion = `${major + 1}.0.0`;
		break;
	case "2":
		newVersion = `${major}.${minor + 1}.0`;
		break;
	case "3":
		newVersion = `${major}.${minor}.${patch + 1}`;
		break;
	case "4": {
		const response = prompt("Enter custom version (format: x.y.z): ");
		if (response && /^\d+\.\d+\.\d+$/.test(response)) {
			newVersion = response;
		} else {
			console.error("Invalid custom version format. Expected format: x.y.z");
			Deno.exit(1);
		}
		break;
	}
	default:
		console.error("Invalid bump type. Please enter 1, 2, 3, or 4.");
		Deno.exit(1);
}

const newDenoJson = denoJson.replace(
	/version":\s*"\d+\.\d+\.\d+"/,
	`version": "${newVersion}"`,
);
let newChartYaml = chartYaml.replace(
	/appVersion:\s*\d+\.\d+\.\d+/,
	`appVersion: ${newVersion}`,
);

if (chartYamlVersion) {
	// Bump chart patch version
	const [chartMajor, chartMinor, chartPatch] = chartYamlVersion
		.split(".")
		.map(Number);
	if (
		chartMajor == null ||
		chartMinor == null ||
		chartPatch == null ||
		Number.isNaN(chartMajor) ||
		Number.isNaN(chartMinor) ||
		Number.isNaN(chartPatch)
	) {
		console.error("Invalid chart version format. Expected format: x.y.z");
		Deno.exit(1);
	}

	const newChartVersion = `${chartMajor}.${chartMinor}.${chartPatch + 1}`;
	newChartYaml = newChartYaml.replace(
		/version:\s*\d+\.\d+\.\d+/,
		`version: ${newChartVersion}`,
	);

	await writeTextFile(
		fromFileUrl(import.meta.resolve("../helm/shuriken/Chart.yaml")),
		newChartYaml,
	);
}

await writeTextFile(
	fromFileUrl(import.meta.resolve("../deno.json")),
	newDenoJson,
);
await writeTextFile(
	fromFileUrl(import.meta.resolve("../helm/shuriken/Chart.yaml")),
	newChartYaml,
);
