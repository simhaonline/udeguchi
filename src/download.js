const fs = require('fs');
const path = require('path');

const commander = require('commander');
const {yellow, magenta, red} = require('kleur');

const {sub_domain} = require('./references.js');
const {get_request, handle_error, render_spinner, green_bg, cyan_bg, safe_name, stream_download, path_exists} = require('./utilities.js');
const {download_hls_video, download_mp4_video} = require('./download_video.js');
const {download_supplementary_assets} = require('./download_assets');
const {download_coding_exercise} = require('./coding-exercise');
const {download_simple_quiz} = require('./simple-quiz');
const download_assignment = require('./assignment');

const create_chapter_folder = ({object_index, title}, course_path) => {
	const chapter_index = `${object_index}`;

	const chapter_name = safe_name(`${chapter_index.padStart(2, '0')} ${title}`);

	console.log(`\n${green_bg('Chapter')}  ${chapter_name}`);

	const chapter_path = path.join(course_path, chapter_name);

	if (!path_exists(chapter_path)) {
		fs.mkdirSync(chapter_path);
	}

	return chapter_path;
};

const download_lecture_article = async (content, chapter_path) => {
	if (content['asset']['asset_type'] !== 'Article') {
		return;
	}

	const {object_index, supplementary_assets, title, asset} = content;
	const article_response_index = `${object_index}`.padStart(3, '0');

	if (supplementary_assets.length > 0) {
		await download_supplementary_assets(
			supplementary_assets,
			chapter_path,
			article_response_index
		);
	}

	const article_name = safe_name(`${article_response_index} ${title}.html`);
	const article_body = asset['body'].replace(/\\"/g, '"').replace(/\n+/g, '<br>');

	const new_article_body = `<html><head><link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/3.3.7/css/bootstrap.min.css" integrity="sha384-BVYiiSIFeK1dGmJRAkycuHAHRg32OmUcww7on3RYdg4Va+PmSTsz/K68vbdEjh4u" crossorigin="anonymous"><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/semantic-ui/2.4.1/components/image.min.css"></head><body><div class="container"><div class="row"><div class="col-md-10 col-md-offset-1 ui image"><p class="lead">${article_body}</p></div></div></div></body></html>`;

	const article_path = path.join(chapter_path, article_name);

	fs.writeFileSync(article_path, new_article_body);

	console.log(`\n  ${magenta().inverse(' Lecture ')}  ${article_name}  ${green_bg('Done')}`);
};

const download_subtitles = (sub, video_name, chapter_path) => {
	const subtitle_request_headers = {
		'User-Agent': 'okhttp/3.11.0'
	};

	if (commander.lang) {
		const lang = sub.find(lang =>
			lang['locale_id'].toLowerCase().includes(commander.lang.toLowerCase())
		);

		if (lang) {
			sub = [lang];
		} else {
			return;
		}
	}

	if (path_exists(path.join(chapter_path, `${video_name}.${sub[0]['locale_id']}.srt`))) {
		return;
	}

	try {
		return Promise.all(sub.map(async subtitle => {
			const subtitle_url = subtitle['url'];
			const subtitle_lang = subtitle['locale_id'];

			const response = await get_request(subtitle_url, subtitle_request_headers);

			// From @wopen/vtt2srt npm package
			const data = response['body']
				.trim()
				.replace(/^WEBVTT/, '')
				.replace(/\r\n/g, '\n')
				.replace(/<v.*>(.*)<\/v>/g, '$1')
				.replace(/(\d\d:\d\d)\.(\d\d\d)\b/g, '$1,$2')
				.replace(/(\n|\s)(\d\d:\d\d,\d\d\d)(\s|\n)/g, '$100:$2$3')
				.split(/\n\n(?:\d+\n)?/g)
				.slice(1)
				.map((piece, i) => `${i + 1}\n${piece}\n\n`)
				.join('');

			fs.writeFileSync(path.join(chapter_path, `${video_name}.${subtitle_lang}.srt`), data);
		}));
	} catch (error) {
		throw error;
	}
};

const download_lecture_ebook = async (content, chapter_path) => {
	if (content['asset']['asset_type'] !== 'E-Book') {
		return;
	}

	const {object_index, supplementary_assets, title, asset} = content;
	const lecture_index = `${object_index}`.padStart(3, '0');
	const lecture_name = safe_name(`${lecture_index} ${title}.pdf`);
	const lecture_url = asset['url_set']['E-Book'][0]['file'];
	const lecture_path = path.join(chapter_path, lecture_name);

	if (supplementary_assets.length > 0) {
		await download_supplementary_assets(
			supplementary_assets,
			chapter_path,
			lecture_index
		);
	}

	if (path_exists(lecture_path)) {
		return console.log(`\n  ${magenta().inverse(' Lecture ')}  ${lecture_name}  ${yellow('(already downloaded)')}`);
	}

	await stream_download(
		lecture_url, lecture_path
	).catch(error => {
		process.stderr.write(`\n  ${magenta().inverse(' Lecture ')}  ${lecture_name}`);

		throw error;
	});

	console.log(`\n  ${magenta().inverse(' Lecture ')}  ${lecture_name}  ${green_bg('Done')}`);
};

const retry_download = (lecture_id, chapter_path) => {
	console.log(`  ${yellow('(fail to connect, retrying)')}`);

	throw new Error(JSON.stringify({lecture_id, chapter_path}));
};

const download_course = async (data, course_path, auth_headers, chapter_path = '') => {
	for (let i = 0; i < data.length; i++) {
		const content = data[i];

		if (content['_class'] === 'chapter') {
			chapter_path = create_chapter_folder(content, course_path);
		}

		try {
			if (content['_class'] === 'lecture') {
				await download_lecture_article(content, chapter_path);

				await download_lecture_ebook(content, chapter_path);

				await download_lecture_video(content, chapter_path, auth_headers);
			}

			if (content['_class'] === 'quiz' && content['type'] === 'simple-quiz') {
				const {object_index} = data.slice(i).find(lecture => lecture['_class'] === 'lecture');

				await download_simple_quiz({content, object_index, chapter_path, auth_headers});
			}

			if (content['_class'] === 'quiz' && content['type'] === 'coding-exercise') {
				const {object_index} = data.slice(i).find(lecture => lecture['_class'] === 'lecture');

				await download_coding_exercise({content, object_index, chapter_path, auth_headers});
			}

			if (content['_class'] === 'practice') {
				const {object_index} = data.slice(i).find(lecture => lecture['_class'] === 'lecture');

				await download_assignment(content, object_index, chapter_path, auth_headers);
			}
		} catch (error) {
			if (error['statusCode'] === 403) {
				retry_download(content.id, chapter_path);
			}

			throw error;
		}
	}
};

const download_lecture_video = async (content, chapter_path, auth_headers) => {
	if (content['asset']['asset_type'] !== 'Video') {
		return;
	}

	const video_lecture = content;

	const lecture_index = `${video_lecture['object_index']}`;
	const video_name = safe_name(`${lecture_index.padStart(3, '0')} ${video_lecture['title']}`);

	if (!commander.skipSub && video_lecture['asset']['captions'].length > 0) {
		await download_subtitles(video_lecture['asset']['captions'], video_name, chapter_path);
	}

	if (video_lecture['supplementary_assets'].length > 0) {
		await download_supplementary_assets(
			video_lecture['supplementary_assets'],
			chapter_path,
			lecture_index.padStart(3, '0')
		);
	}

	if (video_lecture['asset']['url_set']) {
		const check_spinner = {stop: 0};

		try {
			if (path_exists(path.join(chapter_path, `${video_name}.mp4`))) {
				return console.log(`\n  ${magenta().inverse(' Lecture ')}  ${video_name}  ${yellow('(already downloaded)')}`);
			}

			console.log();

			render_spinner(check_spinner, `${magenta().inverse(' Lecture ')}  ${video_name}`);

			const urls_location = video_lecture['asset']['url_set']['Video'];
			const hls_link = commander.hls ? video_lecture['asset']['hls_url'] : null;

			if (hls_link) {
				await download_hls_video(`https${hls_link.slice(5)}`, video_name, chapter_path, auth_headers);
			} else {
				await download_mp4_video(urls_location, video_name, chapter_path);
			}

			clearTimeout(check_spinner.stop);
		} catch (error) {
			clearTimeout(check_spinner.stop);

			if (error['message'] === '403') {
				retry_download(video_lecture.id, chapter_path);
			}

			throw error;
		}
	}
};

const filter_lecture = data => {
	const lecture_index = data.findIndex(l => l['_class'] === 'lecture' && l['object_index'] === parseInt(commander.lecture, 10));

	if (lecture_index !== -1) {
		const chapter_with_lecture = data.slice(0, lecture_index).reverse().find(c => c['_class'] === 'chapter');

		return [chapter_with_lecture, data[lecture_index]];
	}

	handle_error({error: new Error('Unable to find the lecture')});
};

const filter_course_data = (data, start = commander.chapterStart, end = commander.chapterEnd) => {
	const lectures = data.filter(content => {
		return (
			content['_class'] === 'chapter' ||
			(content['_class'] === 'lecture' &&
				content['asset']['asset_type'] === 'Video') ||
			(content['_class'] === 'lecture' &&
				content['asset']['asset_type'] === 'Article') ||
			(content['_class'] === 'lecture' &&
				content['asset']['asset_type'] === 'E-Book') ||
			(content['_class'] === 'quiz' && content['type'] === 'coding-exercise') ||
			(content['_class'] === 'quiz' && content['type'] === 'simple-quiz') ||
			(content['_class'] === 'practice')
		);
	});

	if (lectures[0]['_class'] !== 'chapter') {
		const lost_chapter_name = lectures[0]['title'];
		const lost_chapter = {
			_class: 'chapter',
			title: lost_chapter_name,
			object_index: 1
		};

		lectures.forEach(content => content['_class'] === 'chapter' && content['object_index']++);

		lectures.unshift(lost_chapter);
	}

	if (commander.lecture) {
		return filter_lecture(lectures);
	}

	const chapters = data.filter(c => c['_class'] === 'chapter');

	if (start && parseInt(start, 10) <= chapters.length) {
		const start_index = lectures.findIndex(c => c['_class'] === 'chapter' && c['object_index'] === parseInt(start, 10));
		if (parseInt(end, 10) > parseInt(start, 10)) {
			const end_index = lectures.findIndex(c => c['_class'] === 'chapter' && c['object_index'] === parseInt(end, 10));
			if (end_index !== -1) {
				return lectures.splice(start_index, end_index - start_index);
			}
		}

		return lectures.splice(start_index);
	}

	if (start && parseInt(start, 10) > chapters.length) {
		handle_error({error: new Error(`Course only have ${yellow(chapters.length)} chapters but you start at chapter ${red(start)}`)});
	}

	if (end && parseInt(end, 10) <= chapters.length) {
		const end_index = lectures.findIndex(c => c['_class'] === 'chapter' && c['object_index'] === parseInt(end, 10));
		return lectures.splice(0, end_index);
	}

	return lectures;
};

const get_course_data_multi_requests = async ({course_content_url, auth_headers, course_path, lecture_id, chapter_path, check_spinner, previous_data = []}) => {
	const response = await get_request(course_content_url, auth_headers).catch(error => handle_error({error: new Error(error.message)}));

	const data = JSON.parse(response.body);
	previous_data = [...previous_data, ...data['results']];

	if (data.next) {
		await get_course_data_multi_requests({course_content_url: data.next, auth_headers, course_path, lecture_id, chapter_path, check_spinner, previous_data});
	} else {
		if (check_spinner) {
			console.log(`  ${green_bg('Done')}`);
			clearTimeout(check_spinner.stop);
		}

		let course_data = filter_course_data(previous_data);

		if (lecture_id) {
			const start_again_lecture = course_data.findIndex(content => content['id'] === lecture_id);

			course_data = course_data.slice(start_again_lecture);
		}

		await download_course(course_data, course_path, auth_headers, chapter_path).catch(async error => {
			if (error['message'].includes('lecture_id')) {
				const {lecture_id, chapter_path} = JSON.parse(error['message']);

				await get_course_data_multi_requests({course_content_url: course_content_url.replace(/page=\d/, 'page=1'), auth_headers, course_path, lecture_id, chapter_path})
					.catch(error => handle_error({error}));
			} else {
				handle_error({error});
			}
		});
	}
};

const download_course_contents = async (course_id, auth_headers, course_path) => {
	const course_content_url = `https://${sub_domain}.udemy.com/api-2.0/courses/${course_id}/subscriber-curriculum-items/?fields[lecture]=supplementary_assets,title,asset,object_index&fields[chapter]=title,object_index,chapter_index,sort_order&fields[asset]=title,asset_type,length,url_set,hls_url,captions,body,file_size,filename,external_url&page=1&locale=en_US&page_size=200`;

	const check_spinner = {stop: 0};
	console.log('\n');
	render_spinner(check_spinner, `${cyan_bg('Getting course information')}`);

	await get_course_data_multi_requests({course_content_url, auth_headers, course_path, check_spinner});
};

module.exports = {
	download_course_contents
};
