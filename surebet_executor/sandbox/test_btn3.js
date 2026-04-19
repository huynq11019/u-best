function parseLine(goalText) {
    if (!goalText) return null;
    if (goalText.includes('/')) {
        const parts = goalText.split('/');
        if (parts.length === 2) {
            const p1 = parseFloat(parts[0]);
            const p2 = parseFloat(parts[1]);
            if (!isNaN(p1) && !isNaN(p2)) return (p1 + p2) / 2;
        }
    }
    const val = parseFloat(goalText);
    return isNaN(val) ? null : val;
}
console.log(parseLine("3.5/4")); 
console.log(parseLine("2.5"));
console.log(parseLine("0/0.5"));
