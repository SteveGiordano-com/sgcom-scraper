import playwright from "playwright";
import awsChromium from "chrome-aws-lambda";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { parse } from "node-html-parser";
import dotenv from "dotenv";
import pkg from "pg";
import { today, yesterday } from "./utils/dates.js";

dotenv.config();

const main = async () => {
	const { Pool } = pkg;

	const pool = new Pool({
		"host": process.env.PGHOST,
		"port": process.env.PGPORT,
		"database": process.env.PGDATABASE,
		"user": process.env.PGDATABASE,
		"password": process.env.PGPASSWORD
	});

	const browserOptions = {
		"headless": false
	};

	if (process.env.NODE_ENV === "production") {
		browserOptions.executablePath = await awsChromium.executablePath;
	}

	const allTweets = [];
	const browser = await playwright.chromium.launch(browserOptions);
	const page = await browser.newPage({
		"bypassCSP": true
	});

	let startNum = 0;
	let finished = false;
	let totalTweets = 0;

	await page.goto("https://twitter.com/dadboner");

	try {
		const popupBtn = await page.waitForSelector("div[aria-label='Close']", {
			"timeout": 30000
		});

		await popupBtn.click();
	} catch (err) {
		console.log("No popup; continuing to get tweets.");
	}

	const findTweets = async (num) => {
		const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
		for (let i = num; i < num + 1000; i += 100) {
			window.scrollTo(num, i);
			await delay(100);
		}
	};

	const getTweets = async () => {
		await page.waitForSelector("article[data-testid='tweet']");

		const tweets = await page.$$("article[data-testid='tweet']");
		const allSpansText = await page.locator("span").allTextContents();
		const hasPinnedTweet = allSpansText.includes("Pinned Tweet");

		let total = 0;

		for (const tweet of tweets) {
			total += 1;
			if (total === 1 && hasPinnedTweet) {
				continue;
			}

			const html = await tweet.innerHTML();
			const root = parse(html);
			const tweetDiv = root.querySelector("div[data-testid='tweetText']");

			try {
				const tweetText = tweetDiv.innerText;
				const tweetTime =
					root.querySelector("time[datetime]").rawAttributes.datetime;
				const tweetDate = tweetTime.substring(0, 10);
				const isRetweet = html.includes("Retweeted");
				const tweetUrl =
					root.querySelector("time[datetime]").parentNode.rawAttributes.href;
				const tweetId = tweetUrl.substring(
					tweetUrl.indexOf("/status/") + "/status/".length
				);

				if ((tweetDate === yesterday || tweetDate === today) && !isRetweet) {
					if (!allTweets.some((tweet) => tweet.id === tweetId)) {
						allTweets.push({
							"id": tweetId,
							"text": tweetText,
							"created_at": tweetTime
						});
					}
					console.log("Adding tweet ID", tweetId, tweetDate, tweetText);
				} else if (isRetweet) {
					console.log("Retweet. Continuing to next tweet.");
					continue;
				} else if (tweetDate !== yesterday && tweetDate !== today) {
					console.log("End of today's tweets");
					finished = true;
					break;
				}
			} catch (err) {
				console.log("No text. Continuing.");
				continue;
			}
		}
	};

	while (!finished) {
		await getTweets();
		await page.evaluate(findTweets, startNum);
		startNum += 1000;
	}

	await browser.close();

	const pgClient = await pool.connect();

	for (const tweet of allTweets) {
		try {
			const selectQuery = {
				"name": "select-tweet",
				"text": "SELECT * FROM tweets WHERE id = $1",
				"values": [tweet.id]
			};

			const res = await pgClient.query(selectQuery);

			if (!res.rows[0]) {
				try {
					const insertQuery = {
						"name": "insert-tweet",
						"text":
							"INSERT INTO tweets (id, text, created_at) VALUES ($1, $2, $3) RETURNING *",
						"values": [tweet.id, tweet.text, tweet.created_at]
					};

					await pgClient.query(insertQuery);
					totalTweets += 1;
				} catch (err) {
					console.log(err.stack);
				}
			} else {
				console.log(`Tweet ${tweet.id} already exists`);
			}
		} catch (err) {
			console.log(err.stack);
		}
	}

	pgClient.release();

	const sesClient = new SESClient({
		"region": "us-east-1",
		"credentials": {
			"accessKeyId": process.env.SES_ACCESS_KEY_ID,
			"secretAccessKey": process.env.SES_SECRET_ACCESS_KEY
		}
	});

	const params = {
		"Source": process.env.SES_SOURCE,
		"Destination": {
			"ToAddresses": [process.env.SES_TO]
		},
		"Message": {
			"Body": {
				"Html": {
					"Charset": "UTF-8",
					"Data": `Added ${totalTweets} today.`
				}
			},
			"Subject": {
				"Charset": "UTF-8",
				"Data": `DBC Updates for ${today}.`
			}
		}
	};

	const command = new SendEmailCommand(params);

	try {
		const data = await sesClient.send(command);
		console.log(data);
	} catch (err) {
		console.log(err);
	} finally {
		console.log("Finished sending email.");
	}

	console.log(`Total tweets added: ${totalTweets}`);
};

main();
