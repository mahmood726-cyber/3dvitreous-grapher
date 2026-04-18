const fs = require('fs');
const path = 'C:/Users/user/Downloads/3dvitreous 3d grapher/3dvit.html';

let content = fs.readFileSync(path, 'utf8');

// Add "by Najia Ahmad" after "Vitreous 3D" in the h1
const oldTitle = 'Vitreous 3D\n                </h1>';
const newTitle = 'Vitreous 3D\n                    <span style="font-size: 11px; font-weight: 400; opacity: 0.7; margin-left: 8px;">by Najia Ahmad</span>\n                </h1>';

if (content.includes(oldTitle) && !content.includes('by Najia Ahmad')) {
    content = content.replace(oldTitle, newTitle);
    fs.writeFileSync(path, content);
    console.log('Added "by Najia Ahmad" credit');
} else if (content.includes('by Najia Ahmad')) {
    console.log('Credit already exists');
} else {
    console.log('Could not find title to update');
}
