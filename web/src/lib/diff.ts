export interface DiffLine {
	kind: 'same' | 'add' | 'remove';
	text: string;
}

/** Line diff (longest common subsequence); module files are short. */
export function diffLines(before: string, after: string): DiffLine[] {
	const a = before.split('\n');
	const b = after.split('\n');
	const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = b.length - 1; j >= 0; j--) {
			lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
		}
	}
	const result: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length || j < b.length) {
		if (i < a.length && j < b.length && a[i] === b[j]) {
			result.push({ kind: 'same', text: a[i] });
			i++;
			j++;
		} else if (j < b.length && (i === a.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
			result.push({ kind: 'add', text: b[j++] });
		} else {
			result.push({ kind: 'remove', text: a[i++] });
		}
	}
	return result;
}
