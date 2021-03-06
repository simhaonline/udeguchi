const fs = require('fs');
const path = require('path');

const {safe_name, path_exists, render_spinner, cyan_bg, green_bg, handle_error} = require('./utilities');

const got = require('got');
const {yellow} = require('kleur');
try {
	require.resolve('adm-zip');
} catch (_) {
	handle_error({error: new Error('"adm-zip" dependency not found. Please install it with command "npm install" in the terminal')});
}

const AdmZip = require('adm-zip');

const download_coding_exercise = async ({content, object_index, chapter_path, auth_headers}) => {
	const quiz_index = `${object_index}`.padStart(3, '0');
	const quiz_id = content.id;
	const quiz_title = safe_name(content.title);
	const quiz_name = `${quiz_index} [exercise_info] ${quiz_title}.html`;
	const quiz_path = path.join(chapter_path, quiz_name);

	if (path_exists(quiz_path)) {
		return console.log(`\n   ${cyan_bg('Coding')}  ${quiz_name}  ${yellow('(already downloaded)')}`);
	}

	const check_spinner = {stop: 0};
	console.log();

	render_spinner(check_spinner, ` ${cyan_bg('Coding')}  ${quiz_name}`);

	const response = await got(`https://www.udemy.com/api-2.0/quizzes/${quiz_id}/assessments/?version=1&page_size=250&fields%5Bassessment%5D=id%2Cassessment_type%2Cprompt%2Ccorrect_response`, {
		headers: auth_headers
	}).catch(error => {
		throw new Error(error.message);
	});

	const quiz = JSON.parse(response.body).results[0];

	const html = `<html><head><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/twitter-bootstrap/3.4.1/css/bootstrap.min.css"><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/semantic-ui/2.4.1/components/image.min.css"><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.7.0/css/font-awesome.min.css"></head><body><div class="container"><div class="row"><div class="col-md-10 col-md-offset-1 ui image"><p class="lead"><div class="alert" role="alert"><h4><strong><i class="fa fa-sticky-note-o" aria-hidden="true"></i> Instructions</strong></h4><div class="alert" role="alert" style="background-color: #E9FBE9;border-left: 8px solid #52E052;">${quiz.prompt.instructions}</div></div></p></div></div></div></body></html>`;

	fs.writeFileSync(quiz_path, html);

	const exercise_zip = new AdmZip();
	quiz.prompt['initial_files'].forEach(file => {
		const {file_name: exercise_file_name, content: exercise_content} = file;

		exercise_zip.addFile(path.extname(exercise_file_name) ?
			exercise_file_name :
			`${exercise_file_name}.txt`, Buffer.alloc(exercise_content.length, exercise_content)
		);
	});
	const exercise_name = `[exercise] ${quiz_title}.zip`;
	const exercise_path = path.join(chapter_path, `${quiz_index} ${exercise_name}`);

	const solution_zip = new AdmZip();
	quiz.prompt['solution_files'].forEach(file => {
		const {file_name: solution_file_name, content: solution_content} = file;

		solution_zip.addFile(path.extname(solution_file_name) ?
			solution_file_name :
			`${solution_file_name}.txt`, Buffer.alloc(solution_content.length, solution_content)
		);
	});
	const solution_name = `[exercise_solution] ${quiz_title}.zip`;
	const solution_path = path.join(chapter_path, `${quiz_index} ${solution_name}`);

	exercise_zip.writeZip(exercise_path);
	solution_zip.writeZip(solution_path);

	console.log(`  ${green_bg('Done')}`);
	clearTimeout(check_spinner.stop);
};

module.exports = {download_coding_exercise};
