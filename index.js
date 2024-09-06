require("dotenv").config();
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const sharp = require("sharp");
const path = require("path");
const simpleGit = require("simple-git");
const { execSync } = require("child_process");
const git = simpleGit();

const url = process.env.URL;
const postedNewsFile = "postedNews.json";
const tempDir = "temp";
const repoDir = "novopositorio";

async function getNews() {
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    const news = [];

    $(".news-list-card").each((index, element) => {
      const title = $(element).find(".heading-size-2 a").text().trim();
      const link = $(element).find("a").attr("href");
      const time = $(element)
        .find(".news-list-card-content-byline-date")
        .text()
        .trim();

      let thumbnail = null;
      const style = $(element)
        .find("a.news-list-card-teaser-image")
        .attr("style");
      if (style) {
        const match = style.match(/url\((.*?)\)/);
        if (match && match[1]) {
          thumbnail = match[1].replace(/['"]/g, "");
          const thumbnailUrl = new URL(thumbnail, url);
          thumbnailUrl.search = "";
          thumbnail = thumbnailUrl.href;
        }
      }

      news.push({
        title,
        link: link ? new URL(link, url).href : null,
        thumbnail: thumbnail ? new URL(thumbnail, url).href : null,
        time,
      });
    });

    return news;
  } catch (error) {
    console.error(`Error fetching news: ${error.message}`);
    return [];
  }
}

async function loadPostedNews() {
  if (fs.existsSync(postedNewsFile)) {
    const data = fs.readFileSync(postedNewsFile);
    return JSON.parse(data);
  }
  return [];
}

async function savePostedNews(news) {
  try {
    fs.writeFileSync(postedNewsFile, JSON.stringify(news, null, 2));

    function execCommand(command) {
      try {
        execSync(command, { stdio: "inherit" });
      } catch (error) {
        console.error(`Error executing command ${command}`);
        process.exit(1);
      }
    }

    execCommand(`git config --global user.email ${process.env.EMAIL}`);
    execCommand(`git config --global user.name ${process.env.NAME}`);

    const repoUrlWithToken = process.env.REPOURLWITHTOKEN;
    execCommand(`git clone ${repoUrlWithToken} ${repoDir}`);

    const srcPath = path.join(__dirname, postedNewsFile);
    const destPath = path.join(__dirname, repoDir, postedNewsFile);
    fs.copyFileSync(srcPath, destPath);

    await git.cwd(repoDir);
    await git.add(postedNewsFile);
    await git.commit("Update postedNews.json");
    await git.push("origin", "master");
    console.log("Repositório remoto atualizado com sucesso.");

    fs.rmSync(repoDir, { recursive: true, force: true });
  } catch (error) {
    console.error(`Error saving posted news: ${error.message}`);
  }
}

async function downloadAndOptimizeImage(url, outputPath) {
  const response = await axios({
    url,
    responseType: "arraybuffer",
  });
  const buffer = Buffer.from(response.data, "binary");
  await sharp(buffer).resize(800).toFile(outputPath);
}

async function postToThreads(newsItem) {
  try {
    let attachment = null;
    if (newsItem.thumbnail) {
      const imagePath = path.join(tempDir, `${Date.now()}.jpg`);
      await downloadAndOptimizeImage(newsItem.thumbnail, imagePath);
      attachment = { image: imagePath };
    }

    console.log(`Successfully posted news: ${newsItem.title}`);
  } catch (error) {
    console.error(`Error posting the news: ${error.message}`);
  }
}

async function main() {
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
  }

  const [news, postedNews] = await Promise.all([getNews(), loadPostedNews()]);
  const newPostedNews = [...postedNews];

  const tasks = news.map(async (newsItem) => {
    const alreadyPosted = postedNews.some(
      (posted) => posted.link === newsItem.link
    );

    if (!alreadyPosted) {
      await postToThreads(newsItem);
      newPostedNews.push(newsItem);
    }
  });

  await Promise.all(tasks);
  await savePostedNews(newPostedNews);

  fs.rmSync(tempDir, { recursive: true, force: true });
}

main();
