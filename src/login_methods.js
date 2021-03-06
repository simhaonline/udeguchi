const fs = require('fs');
const {
	handle_error,
	find_access_token,
	create_auth_headers,
	create_cached_cookie,
	green_bg
} = require('./utilities.js');
const {headers, login_url} = require('./references.js');
const upow = require('./upow.js');
const got = require('got');

const login_with_username_password = async (username, password) => {
	console.log(`\n\n${green_bg('Logging with username and password')}\n`);

	try {
		const post_body = {
			email: username,
			password,
			upow: upow(username)
		};

		const post_data = await got(login_url, {
			headers,
			body: post_body,
			form: true
		});

		const access_token = JSON.parse(post_data.body).access_token;

		create_cached_cookie(access_token, username.toLowerCase());

		return create_auth_headers(access_token);
	} catch (error) {
		if (error['code'] === 'ENOTFOUND') {
			handle_error({error, message: 'Unable to connect to Udemy server'});
		}

		handle_error({error, message: error['body']});
	}
};

const login_with_cookie = (cookie_file_name, cached_token) => {
	try {
		let access_token;
		if (cached_token) {
			access_token = cached_token;
		} else {
			process.stdout.write(`\n${green_bg('Logging with cookie')}`);
			const data = fs.readFileSync(cookie_file_name).toString();
			access_token = find_access_token(data);
		}

		if (access_token) {
			return create_auth_headers(access_token);
		}

		handle_error({error: new Error('Cookie is not valid')});
	} catch (error) {
		if (error.code === 'ENOENT') {
			handle_error({error, message: 'File does not exist'});
		} else {
			handle_error({error});
		}
	}
};

module.exports = {
	login_with_username_password,
	login_with_cookie
};
